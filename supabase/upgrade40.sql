-- upgrade40.sql  (run after upgrade39.sql; safe to run twice)
-- Daily class cap and open-class cap, unusual-class detector, announcements that start later.

alter table public.announcements add column if not exists starts_at timestamptz not null default now();

create or replace function public.admin_set_caps(p_per_day int, p_open int) returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(p_per_day, 0) not between 0 and 50 or coalesce(p_open, 0) not between 0 and 20 then return json_build_object('ok', false, 'error', 'Use 0 to 50 classes a day and 0 to 20 open at once. 0 means no limit.'); end if;
  insert into public.app_settings(key, value) values ('policy_max_per_day', coalesce(p_per_day, 0)::text) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.app_settings(key, value) values ('policy_max_open', coalesce(p_open, 0)::text) on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit('caps_set', coalesce(p_per_day, 0) || ' a day, ' || coalesce(p_open, 0) || ' open', null);
  return public.get_public_settings();
end $$;
revoke all on function public.admin_set_caps(int,int) from public, anon;
grant execute on function public.admin_set_caps(int,int) to authenticated;

create or replace function public.policy_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare mm int := coalesce(nullif(public.app_setting('policy_max_minutes'), ''), '0')::int;
        lo int := coalesce(nullif(public.app_setting('policy_min_radius'), ''), '0')::int;
        hi int := coalesce(nullif(public.app_setting('policy_max_radius'), ''), '0')::int;
        vo boolean := coalesce(public.app_setting('rule_venues_only'), '0') = '1';
        hf int := coalesce(nullif(public.app_setting('rule_hour_from'), ''), '0')::int;
        ht int := coalesce(nullif(public.app_setting('rule_hour_to'), ''), '0')::int;
        pd int := coalesce(nullif(public.app_setting('policy_max_per_day'), ''), '0')::int;
        po int := coalesce(nullif(public.app_setting('policy_max_open'), ''), '0')::int;
        mins numeric; ex date; h int; near boolean; c int;
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  select expires_on into ex from public.account_expiry where owner = auth.uid();
  if ex is not null and current_date > ex then raise exception 'Your access ended on %. Please contact the admin.', to_char(ex, 'DD Mon YYYY'); end if;
  if pd > 0 then
    select count(*) into c from public.sessions where teacher_id = auth.uid() and (created_at at time zone 'UTC')::date = (now() at time zone 'UTC')::date;
    if c >= pd then raise exception 'You can start at most % classes a day (set by the admin).', pd; end if;
  end if;
  if po > 0 then
    select count(*) into c from public.sessions where teacher_id = auth.uid() and closes_at > now() and opens_at <= now();
    if c >= po then raise exception 'You can have at most % class(es) open at the same time (set by the admin). Close one first.', po; end if;
  end if;
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
                             'hour_to', coalesce(nullif(public.app_setting('rule_hour_to'), ''), '0')::int,
                             'max_per_day', coalesce(nullif(public.app_setting('policy_max_per_day'), ''), '0')::int,
                             'max_open', coalesce(nullif(public.app_setting('policy_max_open'), ''), '0')::int));
$$;
grant execute on function public.get_public_settings() to anon, authenticated;

-- Classes that look unusual in the last N days.
create or replace function public.admin_anomalies(p_days int default 30) returns table(session_id uuid, course text, owner uuid, created_at timestamptz, kind text, detail text, checkins int)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return query
  with s as (
    select x.id, x.course, x.teacher_id, x.created_at, x.opens_at, x.closes_at from public.sessions x
    where x.created_at > now() - make_interval(days => greatest(1, least(p_days, 365)))),
  st as (
    select s.*, (select count(*) from public.attendance a where a.session_id = s.id)::int n,
           (select count(*) from public.attendance a where a.session_id = s.id and not a.in_range)::int outside,
           coalesce((select max(c) from (select count(*) c from public.attendance a where a.session_id = s.id group by date_trunc('minute', a.checked_in_at)) q), 0)::int burst
    from s),
  avgc as (
    select c.course, c.teacher_id, avg(c.n) a, count(*) k from st c group by c.course, c.teacher_id)
  select st.id, st.course, st.teacher_id, st.created_at, 'Burst'::text, st.burst || ' of ' || st.n || ' check-ins in one minute', st.n from st where st.n >= 15 and st.burst >= 0.6 * st.n
  union all
  select st.id, st.course, st.teacher_id, st.created_at, 'Mostly outside'::text, st.outside || ' of ' || st.n || ' were outside the class area', st.n from st where st.n >= 10 and st.outside >= 0.5 * st.n
  union all
  select st.id, st.course, st.teacher_id, st.created_at, 'Unusually high'::text, st.n || ' check-ins; this lecturer averages ' || round(av.a, 1) || ' for this course', st.n
    from st join avgc av on av.course = st.course and av.teacher_id = st.teacher_id where av.k >= 3 and st.n >= 20 and st.n > 2.5 * av.a
  union all
  select st.id, st.course, st.teacher_id, st.created_at, 'Empty class'::text, 'Open for ' || round(extract(epoch from (st.closes_at - st.opens_at)) / 60) || ' minutes with no check-ins', st.n
    from st where st.n = 0 and st.closes_at < now() and extract(epoch from (st.closes_at - st.opens_at)) >= 1800
  order by 4 desc limit 300;
end $$;
revoke all on function public.admin_anomalies(int) from public, anon;
grant execute on function public.admin_anomalies(int) to authenticated;
