-- upgrade35.sql  (run after upgrade34.sql; safe to run twice)
-- Class limits for everyone: longest class, smallest and largest allowed distance.

create or replace function public.admin_set_policy(p_max_minutes int, p_min_radius int, p_max_radius int) returns json
language plpgsql security definer set search_path to 'public' as $$
declare mm int := coalesce(p_max_minutes, 0); lo int := coalesce(p_min_radius, 0); hi int := coalesce(p_max_radius, 0);
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if mm < 0 or mm > 1440 or lo < 0 or lo > 2000 or hi < 0 or hi > 2000 then return json_build_object('ok', false, 'error', 'Use minutes up to 1440 and distances up to 2000. Use 0 for no limit.'); end if;
  if lo > 0 and hi > 0 and lo > hi then return json_build_object('ok', false, 'error', 'The smallest distance cannot be bigger than the largest.'); end if;
  insert into public.app_settings(key, value) values ('policy_max_minutes', mm::text) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.app_settings(key, value) values ('policy_min_radius', lo::text) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.app_settings(key, value) values ('policy_max_radius', hi::text) on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit('policy_set', mm || ' min, ' || lo || '-' || hi || ' m', null);
  return public.get_public_settings();
end $$;
revoke all on function public.admin_set_policy(int,int,int) from public, anon;
grant execute on function public.admin_set_policy(int,int,int) to authenticated;

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
                             'max_radius', coalesce(nullif(public.app_setting('policy_max_radius'), ''), '0')::int));
$$;
grant execute on function public.get_public_settings() to anon, authenticated;

create or replace function public.policy_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare mm int := coalesce(nullif(public.app_setting('policy_max_minutes'), ''), '0')::int;
        lo int := coalesce(nullif(public.app_setting('policy_min_radius'), ''), '0')::int;
        hi int := coalesce(nullif(public.app_setting('policy_max_radius'), ''), '0')::int; mins numeric;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if mm > 0 and new.closes_at is not null then
    mins := extract(epoch from (new.closes_at - coalesce(new.opens_at, now()))) / 60;
    if mins > mm + 1 then raise exception 'Classes can be open for at most % minutes (set by the admin).', mm; end if;
  end if;
  if lo > 0 and new.radius_m < lo then raise exception 'The allowed distance must be at least % metres (set by the admin).', lo; end if;
  if hi > 0 and new.radius_m > hi then raise exception 'The allowed distance can be at most % metres (set by the admin).', hi; end if;
  return new;
end $$;
drop trigger if exists trg_policy_sessions on public.sessions;
create trigger trg_policy_sessions before insert on public.sessions for each row execute function public.policy_guard();
