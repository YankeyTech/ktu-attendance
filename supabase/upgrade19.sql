-- upgrade19.sql  (run after upgrade18.sql; safe to run twice)
-- 1. Shared-phone alerts: when a phone inside the class area tries to check in a second student, the attempt is saved
--    and the lecturer gets a popup with Allow / Reject. The admin sees every attempt in a log.
-- 2. Admin analytics: attendance by programme and level, at-risk students, lecturer activity.

create table if not exists public.blocked_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  at timestamptz not null default now(),
  index_number text not null,
  student_name text,
  programme text,
  level text,
  device_id text,
  device_index text,
  device_name text,
  lat double precision, lng double precision, accuracy_m double precision, distance_m double precision,
  status text not null default 'pending' check (status in ('pending', 'allowed', 'rejected')),
  decided_at timestamptz
);
create index if not exists blocked_attempts_session_idx on public.blocked_attempts (session_id, status);
create index if not exists blocked_attempts_at_idx on public.blocked_attempts (at desc);
alter table public.blocked_attempts enable row level security;
drop policy if exists "blocked read owner or admin" on public.blocked_attempts;
create policy "blocked read owner or admin" on public.blocked_attempts for select to authenticated
  using (exists (select 1 from public.sessions s where s.id = blocked_attempts.session_id and (s.owner = auth.uid() or public.is_admin())));
drop policy if exists "blocked delete admin" on public.blocked_attempts;
create policy "blocked delete admin" on public.blocked_attempts for delete to authenticated using (public.is_admin());


create or replace function public.resolve_blocked(p_id uuid, p_allow boolean)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare b public.blocked_attempts; s public.sessions;
begin
  select * into b from public.blocked_attempts where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'Alert not found.'); end if;
  select * into s from public.sessions where id = b.session_id;
  if s.owner is distinct from auth.uid() and not public.is_admin() then raise exception 'Not your class'; end if;
  if b.status <> 'pending' then return json_build_object('ok', false, 'error', 'Already decided.'); end if;
  if p_allow then
    insert into public.attendance(session_id, index_number, programme, student_name, level, lat, lng, accuracy_m, distance_m, in_range, manual, note)
    values (b.session_id, b.index_number, coalesce(b.programme, s.programme, '-'), coalesce(b.student_name, b.index_number), coalesce(b.level, s.level, '-'),
            b.lat, b.lng, b.accuracy_m, b.distance_m, true, true, 'Allowed by lecturer after shared-phone alert')
    on conflict (session_id, index_number) do nothing;
  end if;
  update public.blocked_attempts set status = case when p_allow then 'allowed' else 'rejected' end, decided_at = now() where id = p_id;
  perform public.audit(case when p_allow then 'shared_phone_allowed' else 'shared_phone_rejected' end, b.index_number, s.course);
  return json_build_object('ok', true);
end $function$;
grant execute on function public.resolve_blocked(uuid, boolean) to authenticated;

create or replace function public.lvl_key(x text) returns text language sql immutable as
$$ select coalesce(substring(x from '\d{3}'), lower(trim(coalesce(x, '')))) $$;

create or replace function public.admin_breakdown(p_year text default null, p_sem text default null, p_archived boolean default false)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare r json;
begin
  if public.ktu_role() <> 'admin' then raise exception 'Admin only'; end if;
  with ses as (
    select id, owner, course from public.sessions
    where (p_year is null or academic_year = p_year) and (p_sem is null or semester = p_sem) and (p_archived or not archived)
  ), att as (select a.* from public.attendance a join ses on ses.id = a.session_id)
  select json_build_object(
    'groups', (select coalesce(json_agg(g order by g.checkins desc), '[]'::json) from (
      select coalesce(programme, '-') as programme, coalesce(level, '-') as level, count(distinct session_id) as classes, count(*) as checkins,
             count(distinct upper(index_number)) as students, count(*) filter (where in_range) as inr, count(*) filter (where late) as late
      from att group by 1, 2) g),
    'courses', (select coalesce(json_agg(c order by c.checkins desc), '[]'::json) from (
      select ses.course, ses.owner, pr.full_name, pr.email, count(distinct ses.id) as classes, count(att.id) as checkins,
             count(distinct upper(att.index_number)) as students, count(att.id) filter (where att.in_range) as inr
      from ses left join att on att.session_id = ses.id left join public.profiles pr on pr.id = ses.owner
      group by ses.course, ses.owner, pr.full_name, pr.email) c)
  ) into r;
  return r;
end $function$;

create or replace function public.admin_at_risk(p_threshold integer default 75, p_year text default null, p_sem text default null, p_archived boolean default false, p_min integer default 3)
returns json language plpgsql security definer set search_path to 'public' as $function$
declare r json;
begin
  if public.ktu_role() <> 'admin' then raise exception 'Admin only'; end if;
  with ses as (
    select id, owner, course, programme, level, combined, class_groups from public.sessions
    where (p_year is null or academic_year = p_year) and (p_sem is null or semester = p_sem) and (p_archived or not archived)
  ), s_att as (
    select ses.owner, ses.course, upper(a.index_number) as idx, a.student_name, a.programme, a.level, a.session_id, a.in_range
    from public.attendance a join ses on ses.id = a.session_id
  ), people as (
    select owner, course, idx, max(student_name) as nm, max(programme) as programme, max(level) as level,
           count(distinct session_id) filter (where in_range) as attended
    from s_att group by owner, course, idx
    union all
    select r.owner, r.course, upper(r.index_number), r.student_name, r.programme, r.level, 0
    from public.rolls r
    where exists (select 1 from ses where ses.owner = r.owner and ses.course = r.course)
      and not exists (select 1 from s_att x where x.owner = r.owner and x.course = r.course and x.idx = upper(r.index_number))
  ), scored as (
    select p.*, (
      select count(*) from ses s2 where s2.owner = p.owner and s2.course = p.course and (
        case when s2.combined then exists (
               select 1 from jsonb_array_elements(s2.class_groups) g
               where lower(trim(g->>'programme')) = lower(trim(coalesce(p.programme, '')))
                 and (g->>'level' = 'All levels' or public.lvl_key(g->>'level') = public.lvl_key(p.level)))
             else (nullif(trim(s2.programme), '') is null or lower(trim(s2.programme)) = lower(trim(coalesce(p.programme, ''))))
              and (nullif(trim(s2.level), '') is null or public.lvl_key(s2.level) = public.lvl_key(p.level)) end)
    ) as held from people p
  )
  select coalesce(json_agg(x order by x.pct, x.index_number), '[]'::json) into r from (
    select sc.idx as index_number, sc.nm as name, sc.programme, sc.level, sc.course, pr.full_name as lecturer, pr.email,
           sc.attended, sc.held, round(100.0 * sc.attended / sc.held) as pct
    from scored sc left join public.profiles pr on pr.id = sc.owner
    where sc.held >= p_min and 100.0 * sc.attended / sc.held < p_threshold
    order by 10, 1 limit 1000) x;
  return r;
end $function$;

create or replace function public.admin_lecturer_activity()
returns json language plpgsql security definer set search_path to 'public' as $function$
declare r json;
begin
  if public.ktu_role() <> 'admin' then raise exception 'Admin only'; end if;
  select coalesce(json_agg(x order by x.last_sign_in desc nulls last), '[]'::json) into r from (
    select p.id, p.email, p.full_name, p.role, p.active, u.last_sign_in_at as last_sign_in,
      (select count(*) from public.sessions s where s.owner = p.id) as classes_total,
      (select count(*) from public.sessions s where s.owner = p.id and s.created_at > now() - interval '30 days') as classes_30d,
      (select max(s.created_at) from public.sessions s where s.owner = p.id) as last_class,
      (select count(*) from public.attendance a join public.sessions s on s.id = a.session_id where s.owner = p.id and s.created_at > now() - interval '30 days') as checkins_30d,
      (select count(*) from public.attendance a join public.sessions s on s.id = a.session_id where s.owner = p.id and s.created_at > now() - interval '30 days' and a.in_range) as inr_30d
    from public.profiles p left join auth.users u on u.id = p.id
    where p.role <> 'admin') x;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.check_in(p_code text, p_index text, p_programme text, p_lat double precision, p_lng double precision, p_accuracy double precision, p_device text DEFAULT NULL::text, p_ua text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_level text DEFAULT NULL::text, p_token text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s public.sessions; ex public.attendance;
  idx text := upper(trim(p_index)); d double precision; ok boolean;
  w bigint := 0; el double precision; bidx text; bnm text;
  ok_tok boolean; w10 bigint := floor(extract(epoch from now()) / 600);
  v_prog text; v_lvl text; nh text; hdr json; ip text; n int; is_late boolean := false; flag text; dev text := left(p_device, 64);
begin
  -- Rate limit: per phone and per network address.
  begin hdr := current_setting('request.headers', true)::json; exception when others then hdr := null; end;
  ip := coalesce(nullif(split_part(coalesce(hdr->>'x-forwarded-for', ''), ',', 1), ''), 'unknown');
  if random() < 0.02 then delete from public.checkin_attempts where at < now() - interval '10 minutes'; end if;
  if dev is not null then
    select count(*) into n from public.checkin_attempts where key = 'd:' || dev and at > now() - interval '1 minute';
    if n >= 8 then return json_build_object('ok', false, 'error', 'Too many attempts. Wait a minute and try again.'); end if;
    insert into public.checkin_attempts(key) values ('d:' || dev);
  end if;
  select count(*) into n from public.checkin_attempts where key = 'i:' || ip and at > now() - interval '1 minute';
  if n >= 300 then return json_build_object('ok', false, 'error', 'Too many attempts from this network. Wait a minute and try again.'); end if;
  insert into public.checkin_attempts(key) values ('i:' || ip);

  select * into s from public.sessions where code = upper(trim(p_code));
  if not found then return json_build_object('ok', false, 'error', 'Class code not found. Check it and try again.'); end if;
  if now() < s.opens_at or now() > s.closes_at then return json_build_object('ok', false, 'error', 'This class check-in is closed.'); end if;
  -- The 10-minute codes are counted from the moment this class started, so each new class begins with a full 10 minutes.
  el := greatest(extract(epoch from (now() - s.opens_at)), 0);
  w := floor(el / 600)::bigint;
  -- For a single-programme class the lecturer's programme and level are used, whatever the phone sends.
  v_prog := trim(p_programme); v_lvl := trim(p_level);
  if not coalesce(s.combined, false) then
    if nullif(trim(s.programme), '') is not null and s.programme <> 'Combined' then v_prog := trim(s.programme); end if;
    if nullif(trim(s.level), '') is not null then v_lvl := trim(s.level); end if;
  end if;
  if s.rotating then
    if p_token is null then ok_tok := false;
    elsif length(p_token) = 6 then
      ok_tok := p_token = public.rot_token(s.secret, w)
                or (w > 0 and p_token = public.rot_token(s.secret, w - 1) and (el::bigint % 600) < 60);
    else
      ok_tok := dev is not null and p_token in (public.rot_pass(s.secret, dev, w10), public.rot_pass(s.secret, dev, w10 - 1));
    end if;
    if not coalesce(ok_tok, false) then
      return json_build_object('ok', false, 'error', 'The screen code has expired. Scan the QR code on the lecturer screen again.');
    end if;
  end if;
  if idx !~ '^[A-Z0-9/\-]{4,30}$' then return json_build_object('ok', false, 'error', 'Enter a valid index number.'); end if;
  if p_name is null or char_length(trim(p_name)) not between 3 and 100 then return json_build_object('ok', false, 'error', 'Enter your full name.'); end if;
  if v_lvl is null or char_length(v_lvl) not between 2 and 30 then return json_build_object('ok', false, 'error', 'Choose your level.'); end if;
  if v_prog is null or char_length(v_prog) not between 2 and 120 then return json_build_object('ok', false, 'error', 'Choose your programme.'); end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    return json_build_object('ok', false, 'error', 'Location is required to check in.'); end if;

  d := public.haversine_m(s.lat, s.lng, p_lat, p_lng);
  ok := d <= s.radius_m + least(coalesce(p_accuracy, 0), 50);

  -- Already checked in: allow the end-of-class scan if the lecturer opened it.
  select * into ex from public.attendance where session_id = s.id and index_number = idx;
  if found then
    if s.two_point and s.end_open and ex.end_at is null then
      if ex.device_id is not null and dev is not null and ex.device_id <> dev then
        return json_build_object('ok', false, 'error', 'Use the same phone you checked in with.');
      end if;
      update public.attendance set end_at = now(), end_distance = d, end_in_range = ok where id = ex.id;
      return json_build_object('ok', true, 'phase', 'end', 'in_range', ok, 'course', s.course, 'distance_m', round(d),
        'name', ex.student_name, 'index', idx, 'level', ex.level, 'at', now());
    end if;
    return json_build_object('ok', false, 'error', 'This index number has already checked in.');
  end if;

  if s.combined and not exists (
      select 1 from jsonb_array_elements(s.class_groups) g
      where g->>'programme' = v_prog and (g->>'level' = 'All levels' or g->>'level' = v_lvl)) then
    return json_build_object('ok', false, 'error', 'Your programme and level are not part of this combined class. Choose the ones you are registered for.');
  end if;

  if s.block_shared and dev is not null and exists (
    select 1 from public.attendance where session_id = s.id and device_id = dev and index_number <> idx) then
    -- A phone inside the class area is trying to check in a second student: alert the lecturer, who can allow or reject.
    if ok then
      select a.index_number, a.student_name into bidx, bnm from public.attendance a
        where a.session_id = s.id and a.device_id = dev and a.index_number <> idx order by a.checked_in_at limit 1;
      if not exists (select 1 from public.blocked_attempts where session_id = s.id and index_number = idx and status in ('pending', 'rejected'))
         and (select count(*) from public.blocked_attempts where session_id = s.id and device_id = dev and status = 'pending') < 5 then
        insert into public.blocked_attempts(session_id, index_number, student_name, programme, level, device_id, device_index, device_name, lat, lng, accuracy_m, distance_m)
        values (s.id, idx, trim(p_name), v_prog, v_lvl, dev, bidx, bnm, p_lat, p_lng, p_accuracy, d);
      end if;
      return json_build_object('ok', false, 'error', 'This phone has already been used for another student in this class. Your lecturer has been alerted and can approve you. Wait a moment, or ask them to add you.');
    end if;
    return json_build_object('ok', false, 'error', 'This phone has already been used for another student in this class. Ask your lecturer to add you.');
  end if;

  if s.late_after_min is not null and now() > s.opens_at + make_interval(mins => s.late_after_min) then is_late := true; end if;
  if coalesce(p_accuracy, 0) <= 0 then flag := 'No GPS accuracy';
  elsif p_accuracy > 150 then flag := 'Weak GPS signal'; end if;
  if exists (select 1 from public.attendance where session_id = s.id and lat = p_lat and lng = p_lng) then
    flag := 'Same coordinates as another student'; end if;

  -- Same network name (hashed), same phone type, within 5 m and under 2 minutes of another student: likely one phone used twice.
  nh := left(encode(sha256(convert_to(ip || s.secret, 'UTF8')), 'hex'), 16);
  if ip <> 'unknown' and p_ua is not null and exists (
      select 1 from public.attendance a
      where a.session_id = s.id and a.index_number <> idx and a.net_hash = nh and a.user_agent = left(p_ua, 300)
        and a.checked_in_at > now() - interval '2 minutes' and a.lat is not null
        and public.haversine_m(a.lat, a.lng, p_lat, p_lng) < 5) then
    flag := concat_ws('; ', flag, 'Possible same phone (close, same network, seconds apart)');
  end if;

  begin
    insert into public.attendance(session_id, index_number, programme, student_name, level, lat, lng, accuracy_m, distance_m, in_range, device_id, user_agent, late, gps_flag, net_hash)
    values (s.id, idx, v_prog, trim(p_name), v_lvl, p_lat, p_lng, p_accuracy, d, ok, dev, left(p_ua, 300), is_late, flag, nh);
  exception when unique_violation then
    return json_build_object('ok', false, 'error', 'This index number has already checked in.');
  end;

  return json_build_object('ok', true, 'phase', 'start', 'radius_m', s.radius_m, 'accuracy_m', round(coalesce(p_accuracy, 0)), 'in_range', ok, 'late', is_late, 'course', s.course, 'distance_m', round(d),
    'name', trim(p_name), 'index', idx, 'level', v_lvl, 'at', now());
end $function$;
