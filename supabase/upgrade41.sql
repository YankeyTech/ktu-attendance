-- upgrade41.sql  (run after upgrade40.sql; safe to run twice)
-- Update 45: bulk class controls, defaults, texts, health check, insights data.

-- 1. Close every open class right now (emergency / end of day).
create or replace function public.admin_close_all_open() returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  update public.sessions set closes_at = now() where closes_at > now() and opens_at <= now() and not coalesce(archived, false);
  get diagnostics n = row_count;
  perform public.audit('close_all', n || ' open classes closed', null);
  return n;
end $$;

-- 2. Give every open class extra minutes.
create or replace function public.admin_extend_all_open(p_minutes int) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(p_minutes, 0) not between 1 and 240 then raise exception 'Use 1 to 240 minutes'; end if;
  update public.sessions set closes_at = closes_at + make_interval(mins => p_minutes) where closes_at > now() and opens_at <= now() and not coalesce(archived, false);
  get diagnostics n = row_count;
  perform public.audit('extend_all', n || ' open classes +' || p_minutes || ' min', null);
  return n;
end $$;

-- 3. Archive (lock away) finished classes older than N days.
create or replace function public.admin_archive_old(p_days int, p_dry boolean default false) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(p_days, 0) not between 7 and 3650 then raise exception 'Use 7 to 3650 days'; end if;
  if p_dry then
    select count(*) into n from public.sessions where not coalesce(archived, false) and closes_at < now() - make_interval(days => p_days);
    return n;
  end if;
  update public.sessions set archived = true where not coalesce(archived, false) and closes_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  perform public.audit('archive_old', n || ' classes older than ' || p_days || ' days archived', null);
  return n;
end $$;

-- 4. Defaults for new classes and short texts shown to people.
create or replace function public.admin_set_defaults(p_minutes int, p_radius int) returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(p_minutes, 0) not between 0 and 240 or coalesce(p_radius, 0) not between 0 and 2000 or (coalesce(p_radius, 0) between 1 and 19) then
    return json_build_object('ok', false, 'error', 'Minutes 0 to 240, distance 20 to 2000 (0 means use the standard value).');
  end if;
  insert into public.app_settings(key, value) values ('default_minutes', coalesce(p_minutes, 0)::text) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.app_settings(key, value) values ('default_radius', coalesce(p_radius, 0)::text) on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit('defaults_set', coalesce(p_minutes, 0) || ' min, ' || coalesce(p_radius, 0) || ' m', null);
  return public.get_public_settings();
end $$;

create or replace function public.admin_set_text(p_key text, p_value text) returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_key not in ('welcome_msg', 'student_notice') then return json_build_object('ok', false, 'error', 'Unknown text'); end if;
  if char_length(coalesce(p_value, '')) > 400 then return json_build_object('ok', false, 'error', 'Keep it under 400 characters.'); end if;
  insert into public.app_settings(key, value) values ('txt_' || p_key, coalesce(trim(p_value), '')) on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit('text_set', p_key, null);
  return public.get_public_settings();
end $$;

-- 5. Health check.
create or replace function public.admin_health() returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return json_build_object(
    'db_mb', round(pg_database_size(current_database()) / 1048576.0, 1),
    'staff', (select count(*) from public.profiles),
    'classes', (select count(*) from public.sessions),
    'open_now', (select count(*) from public.sessions where opens_at <= now() and closes_at > now()),
    'attendance', (select count(*) from public.attendance),
    'last_checkin', (select max(checked_in_at) from public.attendance),
    'first_checkin', (select min(checked_in_at) from public.attendance),
    'today', (select count(*) from public.attendance where checked_in_at >= date_trunc('day', now())),
    'audit', (select count(*) from public.audit_log),
    'trash', (select count(*) from public.trash),
    'blocked', (select count(*) from public.blocked_students),
    'no_name', (select count(*) from public.profiles where coalesce(trim(full_name), '') = ''),
    'inactive', (select count(*) from public.profiles where not coalesce(active, true)));
end $$;

create or replace function public.get_public_settings() returns json
language sql stable security definer set search_path to 'public' as $$
  select json_build_object('paused', coalesce(public.app_setting('pause_checkins'), '') = '1',
                           'message', coalesce(public.app_setting('pause_message'), ''),
                           'popups', coalesce(public.app_setting('popups_off'), '') <> '1',
                           'year', coalesce(public.app_setting('term_year'), ''),
                           'semester', coalesce(public.app_setting('term_sem'), ''),
                           'features', json_build_object(
                             'new_classes', public.feature_on('new_classes'), 'manual_add', public.feature_on('manual_add'),
                             'chat', public.feature_on('chat'), 'rolls', public.feature_on('rolls'),
                             'exports', public.feature_on('exports'), 'lookup', public.feature_on('lookup'), 'announce', public.feature_on('announce')),
                           'policy', json_build_object(
                             'max_minutes', coalesce(nullif(public.app_setting('policy_max_minutes'), ''), '0')::int,
                             'min_radius', coalesce(nullif(public.app_setting('policy_min_radius'), ''), '0')::int,
                             'max_radius', coalesce(nullif(public.app_setting('policy_max_radius'), ''), '0')::int,
                             'venues_only', coalesce(public.app_setting('rule_venues_only'), '0') = '1',
                             'hour_from', coalesce(nullif(public.app_setting('rule_hour_from'), ''), '0')::int,
                             'hour_to', coalesce(nullif(public.app_setting('rule_hour_to'), ''), '0')::int,
                             'max_per_day', coalesce(nullif(public.app_setting('policy_max_per_day'), ''), '0')::int,
                             'max_open', coalesce(nullif(public.app_setting('policy_max_open'), ''), '0')::int),
                           'defaults', json_build_object(
                             'minutes', coalesce(nullif(public.app_setting('default_minutes'), ''), '0')::int,
                             'radius', coalesce(nullif(public.app_setting('default_radius'), ''), '0')::int),
                           'texts', json_build_object(
                             'welcome', coalesce(public.app_setting('txt_welcome_msg'), ''),
                             'student', coalesce(public.app_setting('txt_student_notice'), '')));
$$;
grant execute on function public.get_public_settings() to anon, authenticated;

revoke all on function public.admin_close_all_open() from public, anon;
revoke all on function public.admin_extend_all_open(int) from public, anon;
revoke all on function public.admin_archive_old(int, boolean) from public, anon;
revoke all on function public.admin_set_defaults(int, int) from public, anon;
revoke all on function public.admin_set_text(text, text) from public, anon;
revoke all on function public.admin_health() from public, anon;
grant execute on function public.admin_close_all_open() to authenticated;
grant execute on function public.admin_extend_all_open(int) to authenticated;
grant execute on function public.admin_archive_old(int, boolean) to authenticated;
grant execute on function public.admin_set_defaults(int, int) to authenticated;
grant execute on function public.admin_set_text(text, text) to authenticated;
grant execute on function public.admin_health() to authenticated;
