-- upgrade30.sql  (run after upgrade29.sql; safe to run twice)
-- Admin: block a student or a phone from checking in, make a new code for a class, set the current term for everyone.

create table if not exists public.blocked_students (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('index','device')),
  value      text not null check (char_length(value) between 3 and 64),
  reason     text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (kind, value)
);
alter table public.blocked_students enable row level security;
revoke all on public.blocked_students from anon, authenticated;

create or replace function public.admin_block(p_kind text, p_value text, p_reason text) returns json
language plpgsql security definer set search_path to 'public' as $$
declare v text := case when p_kind = 'index' then upper(trim(p_value)) else trim(p_value) end;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_kind not in ('index','device') or char_length(coalesce(v, '')) < 3 then return json_build_object('ok', false, 'error', 'Enter a valid index number or device code.'); end if;
  insert into public.blocked_students(kind, value, reason) values (p_kind, v, left(coalesce(p_reason, ''), 200)) on conflict (kind, value) do update set reason = excluded.reason;
  perform public.audit('student_blocked', v, left(coalesce(p_reason, ''), 200));
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_unblock(p_id uuid) returns json
language plpgsql security definer set search_path to 'public' as $$
declare v text;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  delete from public.blocked_students where id = p_id returning value into v;
  perform public.audit('student_unblocked', v, null);
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_list_blocked() returns table(id uuid, kind text, value text, reason text, created_at timestamptz)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return query select b.id, b.kind, b.value, b.reason, b.created_at from public.blocked_students b order by b.created_at desc;
end $$;

-- Give a class a new code (when the old one was shared too widely). Students who already checked in are not affected.
create or replace function public.admin_regen_code(p_id uuid) returns json
language plpgsql security definer set search_path to 'public' as $$
declare c text; alpha text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int; old text;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select code into old from public.sessions where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'Class not found.'); end if;
  loop
    c := '';
    for i in 1..6 loop c := c || substr(alpha, 1 + floor(random() * length(alpha))::int, 1); end loop;
    exit when not exists (select 1 from public.sessions where code = c);
  end loop;
  update public.sessions set code = c where id = p_id;
  perform public.audit('code_changed', old, 'new code ' || c);
  return json_build_object('ok', true, 'code', c);
end $$;

-- The current academic year and semester, offered to every lecturer when they start a class.
create or replace function public.admin_set_term(p_year text, p_sem text) returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  insert into public.app_settings(key, value) values ('term_year', left(coalesce(p_year, ''), 20)) on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.app_settings(key, value) values ('term_sem', left(coalesce(p_sem, ''), 30)) on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit('term_set', coalesce(p_year, '') || ' ' || coalesce(p_sem, ''), null);
  return public.get_public_settings();
end $$;

create or replace function public.get_public_settings() returns json
language sql stable security definer set search_path to 'public' as $$
  select json_build_object('paused', coalesce(public.app_setting('pause_checkins'), '') = '1',
                           'message', coalesce(public.app_setting('pause_message'), ''),
                           'popups', coalesce(public.app_setting('popups_off'), '') <> '1',
                           'year', coalesce(public.app_setting('term_year'), ''),
                           'semester', coalesce(public.app_setting('term_sem'), ''));
$$;
grant execute on function public.get_public_settings() to anon, authenticated;

do $$ declare f text; begin
  foreach f in array array['admin_block(text,text,text)','admin_unblock(uuid)','admin_list_blocked()','admin_regen_code(uuid)','admin_set_term(text,text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

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
  ok_tok boolean; w10 bigint := 0;
  v_prog text; v_lvl text; nh text; hdr json; ip text; n int; is_late boolean := false; flag text; dev text := left(p_device, 64);
begin
  -- The admin can pause all check-ins (Tools tab).
  if public.app_setting('pause_checkins') = '1' then
    return json_build_object('ok', false, 'error', coalesce(nullif(public.app_setting('pause_message'), ''), 'Check-in is paused by the admin. Try again later.'));
  end if;
  -- Students or phones the admin has blocked (Student lookup / Tools tab).
  if exists (select 1 from public.blocked_students x where (x.kind = 'index' and x.value = upper(trim(p_index))) or (x.kind = 'device' and p_device is not null and x.value = left(p_device, 64))) then
    return json_build_object('ok', false, 'error', 'This index number or phone has been blocked from checking in. Please see your lecturer or the admin.');
  end if;
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
  w := 0;  -- one screen code for the whole class
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
    -- A phone is being used for a second student (inside or outside the class area): save it and alert the lecturer.
    select a.index_number, a.student_name into bidx, bnm from public.attendance a
      where a.session_id = s.id and a.device_id = dev and a.index_number <> idx order by a.checked_in_at limit 1;
    if not exists (select 1 from public.blocked_attempts where session_id = s.id and index_number = idx and status in ('pending', 'rejected'))
       and (select count(*) from public.blocked_attempts where session_id = s.id and device_id = dev and status = 'pending') < 5 then
      insert into public.blocked_attempts(session_id, index_number, student_name, programme, level, device_id, device_index, device_name, lat, lng, accuracy_m, distance_m, in_range)
      values (s.id, idx, trim(p_name), v_prog, v_lvl, dev, bidx, bnm, p_lat, p_lng, p_accuracy, d, ok);
    end if;
    return json_build_object('ok', false, 'error', 'This phone has already been used for another student in this class. Your lecturer has been alerted and can approve you. Wait a moment, or ask them to add you.');
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
