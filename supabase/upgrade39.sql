-- upgrade39.sql  (run after upgrade38.sql; safe to run twice)
-- Four admin controls: lock classes, approved venues only, allowed class hours, account expiry dates.

-- 1) Lock classes: nobody but the admin can change a locked class or its check-ins.
alter table public.sessions add column if not exists locked boolean not null default false;

create or replace function public.lock_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare sid uuid; l boolean;
begin
  if auth.uid() is null or public.is_admin() then return coalesce(new, old); end if;
  if tg_table_name = 'sessions' then
    if tg_op = 'UPDATE' then
      if old.locked then raise exception 'This class is locked by the admin.'; end if;
      if new.locked then raise exception 'Only the admin can lock a class.'; end if;
      return new;
    elsif tg_op = 'DELETE' then
      if old.locked then raise exception 'This class is locked by the admin and cannot be deleted.'; end if;
      return old;
    end if;
  else
    sid := coalesce(to_jsonb(new)->>'session_id', to_jsonb(old)->>'session_id')::uuid;
    select locked into l from public.sessions where id = sid;
    if coalesce(l, false) then raise exception 'This class is locked by the admin. Its check-ins cannot be changed.'; end if;
    return coalesce(new, old);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_lock_sessions on public.sessions;
create trigger trg_lock_sessions before update or delete on public.sessions for each row execute function public.lock_guard();
drop trigger if exists trg_lock_attendance on public.attendance;
create trigger trg_lock_attendance before insert or update or delete on public.attendance for each row execute function public.lock_guard();

create or replace function public.admin_lock_classes(p_ids uuid[], p_locked boolean) returns json
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  update public.sessions set locked = p_locked where id = any(p_ids); get diagnostics n = row_count;
  perform public.audit(case when p_locked then 'classes_locked' else 'classes_unlocked' end, n || ' classes', null);
  return json_build_object('ok', true, 'count', n);
end $$;

create or replace function public.admin_lock_term(p_year text, p_sem text, p_locked boolean) returns json
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(p_year, '') = '' and coalesce(p_sem, '') = '' then return json_build_object('ok', false, 'error', 'Choose an academic year or a semester.'); end if;
  update public.sessions set locked = p_locked
    where (coalesce(p_year, '') = '' or academic_year = p_year) and (coalesce(p_sem, '') = '' or semester = p_sem); get diagnostics n = row_count;
  perform public.audit(case when p_locked then 'term_locked' else 'term_unlocked' end, coalesce(p_year, '') || ' ' || coalesce(p_sem, ''), n || ' classes');
  return json_build_object('ok', true, 'count', n);
end $$;

-- 2) and 3) Approved venues only, and the hours in which a class may start (Ghana time is UTC).
create or replace function public.admin_set_rules(p_venues_only boolean, p_hour_from int, p_hour_to int) returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(p_hour_from, 0) not between 0 and 23 or coalesce(p_hour_to, 0) not between 0 and 24 then return json_build_object('ok', false, 'error', 'Use hours from 0 to 24.'); end if;
  if coalesce(p_hour_to, 0) > 0 and coalesce(p_hour_from, 0) >= p_hour_to then return json_build_object('ok', false, 'error', 'The first hour must be before the last hour.'); end if;
  insert into public.app_settings(key, value) values ('rule_venues_only', case when p_venues_only then '1' else '0' end) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.app_settings(key, value) values ('rule_hour_from', coalesce(p_hour_from, 0)::text) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.app_settings(key, value) values ('rule_hour_to', coalesce(p_hour_to, 0)::text) on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit('rules_set', case when p_venues_only then 'approved venues only' else 'any place' end, coalesce(p_hour_from, 0) || ' to ' || coalesce(p_hour_to, 0));
  return public.get_public_settings();
end $$;

-- 4) Account expiry: a lecturer who has an end date cannot start classes after it.
create table if not exists public.account_expiry (owner uuid primary key, expires_on date not null, note text);
alter table public.account_expiry enable row level security;
revoke all on public.account_expiry from anon, authenticated;

create or replace function public.admin_set_expiry(p_id uuid, p_date date, p_note text default null) returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_date is null then delete from public.account_expiry where owner = p_id;
  else insert into public.account_expiry(owner, expires_on, note) values (p_id, p_date, left(coalesce(p_note, ''), 200)) on conflict (owner) do update set expires_on = excluded.expires_on, note = excluded.note; end if;
  perform public.audit('expiry_set', (select email from public.profiles where id = p_id), coalesce(p_date::text, 'removed'));
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_list_expiry() returns table(owner uuid, expires_on date, note text)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return query select e.owner, e.expires_on, e.note from public.account_expiry e order by e.expires_on;
end $$;

create or replace function public.my_expiry() returns date
language sql stable security definer set search_path to 'public' as $$
  select expires_on from public.account_expiry where owner = auth.uid()
$$;

-- The rules above are enforced when a class is started.
create or replace function public.policy_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare mm int := coalesce(nullif(public.app_setting('policy_max_minutes'), ''), '0')::int;
        lo int := coalesce(nullif(public.app_setting('policy_min_radius'), ''), '0')::int;
        hi int := coalesce(nullif(public.app_setting('policy_max_radius'), ''), '0')::int;
        vo boolean := coalesce(public.app_setting('rule_venues_only'), '0') = '1';
        hf int := coalesce(nullif(public.app_setting('rule_hour_from'), ''), '0')::int;
        ht int := coalesce(nullif(public.app_setting('rule_hour_to'), ''), '0')::int;
        mins numeric; ex date; h int; near boolean;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  select expires_on into ex from public.account_expiry where owner = auth.uid();
  if ex is not null and current_date > ex then raise exception 'Your access ended on %. Please contact the admin.', to_char(ex, 'DD Mon YYYY'); end if;
  if mm > 0 and new.closes_at is not null then
    mins := extract(epoch from (new.closes_at - coalesce(new.opens_at, now()))) / 60;
    if mins > mm + 1 then raise exception 'Classes can be open for at most % minutes (set by the admin).', mm; end if;
  end if;
  if lo > 0 and new.radius_m < lo then raise exception 'The allowed distance must be at least % metres (set by the admin).', lo; end if;
  if hi > 0 and new.radius_m > hi then raise exception 'The allowed distance can be at most % metres (set by the admin).', hi; end if;
  if ht > 0 then
    h := extract(hour from (coalesce(new.opens_at, now()) at time zone 'UTC'))::int;
    if h < hf or h >= ht then raise exception 'Classes can only be started between %:00 and %:00 (set by the admin).', hf, ht; end if;
  end if;
  if vo then
    select exists (select 1 from public.shared_venues v
      where 6371000 * 2 * asin(least(1, sqrt(power(sin(radians(new.lat - v.lat) / 2), 2) + cos(radians(v.lat)) * cos(radians(new.lat)) * power(sin(radians(new.lng - v.lng) / 2), 2)))) <= greatest(coalesce(v.radius_m, 100), 100) + 50) into near;
    if not near then raise exception 'Classes can only be started at a venue approved by the admin. Pick a shared venue (marked with a star).'; end if;
  end if;
  return new;
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
                             'hour_to', coalesce(nullif(public.app_setting('rule_hour_to'), ''), '0')::int));
$$;
grant execute on function public.get_public_settings() to anon, authenticated;

do $$ declare f text; begin
  foreach f in array array['admin_lock_classes(uuid[],boolean)','admin_lock_term(text,text,boolean)','admin_set_rules(boolean,int,int)','admin_set_expiry(uuid,date,text)','admin_list_expiry()','my_expiry()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
