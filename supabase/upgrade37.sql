-- upgrade37.sql  (run after upgrade36.sql; safe to run twice)
-- Scheduled pause (maintenance window) and a list of index numbers that have more than one name.

-- The pause setting now respects a start and end time. Nothing else that reads it needs to change.
create or replace function public.app_setting(k text) returns text
language plpgsql stable security definer set search_path to 'public' as $$
declare v text; f text; u text;
begin
  select value into v from public.app_settings where key = k;
  if k = 'pause_checkins' and v = '1' then
    select value into f from public.app_settings where key = 'pause_from';
    select value into u from public.app_settings where key = 'pause_until';
    if nullif(f, '') is not null and now() < f::timestamptz then return '0'; end if;
    if nullif(u, '') is not null and now() > u::timestamptz then return '0'; end if;
  end if;
  return v;
end $$;

create or replace function public.admin_schedule_pause(p_from timestamptz, p_until timestamptz, p_message text) returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_until is null or p_until <= now() then return json_build_object('ok', false, 'error', 'Choose an end time in the future.'); end if;
  if p_from is not null and p_from >= p_until then return json_build_object('ok', false, 'error', 'The start must be before the end.'); end if;
  insert into public.app_settings(key, value) values ('pause_checkins', '1') on conflict (key) do update set value = '1', updated_at = now();
  insert into public.app_settings(key, value) values ('pause_from', coalesce(p_from::text, '')) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.app_settings(key, value) values ('pause_until', p_until::text) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.app_settings(key, value) values ('pause_message', left(coalesce(p_message, ''), 300)) on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit('pause_scheduled', coalesce(p_from::text, 'now') || ' to ' || p_until::text, left(coalesce(p_message, ''), 200));
  return public.admin_pause_schedule();
end $$;

create or replace function public.admin_clear_schedule() returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  delete from public.app_settings where key in ('pause_from', 'pause_until');
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_pause_schedule() returns json
language plpgsql security definer set search_path to 'public' as $$
declare f text; u text; v text;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select value into v from public.app_settings where key = 'pause_checkins';
  select value into f from public.app_settings where key = 'pause_from';
  select value into u from public.app_settings where key = 'pause_until';
  return json_build_object('from', nullif(f, ''), 'until', nullif(u, ''), 'armed', v = '1' and nullif(u, '') is not null and now() < u::timestamptz, 'active', coalesce(public.app_setting('pause_checkins'), '') = '1');
end $$;

create or replace function public.admin_name_conflicts() returns table(index_number text, names text[], uses int)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return query
    select upper(a.index_number), array_agg(distinct btrim(regexp_replace(a.student_name, '\s+', ' ', 'g'))), count(*)::int
    from public.attendance a where a.student_name is not null and btrim(a.student_name) <> ''
    group by upper(a.index_number)
    having count(distinct lower(btrim(regexp_replace(a.student_name, '\s+', ' ', 'g')))) > 1
    order by count(*) desc limit 300;
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_schedule_pause(timestamptz,timestamptz,text)','admin_clear_schedule()','admin_pause_schedule()','admin_name_conflicts()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  grant execute on function public.app_setting(text) to anon, authenticated;
end $$;
