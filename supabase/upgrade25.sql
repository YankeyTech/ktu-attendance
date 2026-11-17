-- upgrade25.sql  (run after upgrade24.sql; safe to run twice)
-- Admin control tools: pause check-ins, edit a class (and move it to another lecturer), fix check-ins,
-- correct a student's index number or name everywhere, and a health check with one-click fixes.

create table if not exists public.app_settings (key text primary key, value text, updated_at timestamptz not null default now());
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

create or replace function public.app_setting(k text) returns text
language sql stable security definer set search_path to 'public' as $$ select value from public.app_settings where key = k $$;

-- Anyone (including the student page) may read whether check-ins are paused, and the message.
create or replace function public.get_public_settings() returns json
language sql stable security definer set search_path to 'public' as $$
  select json_build_object('paused', coalesce(public.app_setting('pause_checkins'), '') = '1', 'message', coalesce(public.app_setting('pause_message'), ''));
$$;
grant execute on function public.get_public_settings() to anon, authenticated;

create or replace function public.admin_set_pause(p_on boolean, p_message text) returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  insert into public.app_settings(key, value) values ('pause_checkins', case when p_on then '1' else '0' end)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.app_settings(key, value) values ('pause_message', left(coalesce(p_message, ''), 300))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit(case when p_on then 'checkins_paused' else 'checkins_resumed' end, 'all classes', left(coalesce(p_message, ''), 200));
  return public.get_public_settings();
end $$;
revoke all on function public.admin_set_pause(boolean, text) from public, anon;
grant execute on function public.admin_set_pause(boolean, text) to authenticated;

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

-- Edit a class. Pass the owner to move it to another lecturer.
create or replace function public.admin_edit_class(p_id uuid, p_course text, p_programme text, p_level text, p_year text, p_sem text, p_radius int, p_owner uuid) returns json
language plpgsql security definer set search_path to 'public' as $$
declare s public.sessions;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into s from public.sessions where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'Class not found.'); end if;
  if char_length(trim(coalesce(p_course, ''))) not between 2 and 120 then return json_build_object('ok', false, 'error', 'The course name must be 2 to 120 characters.'); end if;
  if p_radius is null or p_radius not between 20 and 2000 then return json_build_object('ok', false, 'error', 'The radius must be between 20 and 2000 metres.'); end if;
  if p_owner is not null and p_owner <> s.owner then
    if not exists (select 1 from public.profiles where id = p_owner and role <> 'admin' and deleted_at is null) then
      return json_build_object('ok', false, 'error', 'Choose an active lecturer or teaching assistant.');
    end if;
    if not exists (select 1 from public.courses where owner = p_owner and lower(name) = lower(trim(p_course))) then
      insert into public.courses(owner, name) values (p_owner, trim(p_course));
    end if;
  end if;
  update public.sessions set course = trim(p_course),
    programme = case when s.combined then programme else nullif(trim(coalesce(p_programme, '')), '') end,
    level = case when s.combined then level else nullif(trim(coalesce(p_level, '')), '') end,
    academic_year = nullif(trim(coalesce(p_year, '')), ''), semester = nullif(trim(coalesce(p_sem, '')), ''), radius_m = p_radius,
    owner = coalesce(p_owner, owner), teacher_id = coalesce(p_owner, teacher_id)
  where id = p_id;
  perform public.audit('class_edited', trim(p_course), case when p_owner is not null and p_owner <> s.owner then 'moved to another lecturer' else 'details changed' end);
  return json_build_object('ok', true);
end $$;

-- Change one check-in: delete it, flip in/out of area, flip late, or change the name.
create or replace function public.admin_edit_checkin(p_id uuid, p_action text, p_value text) returns json
language plpgsql security definer set search_path to 'public' as $$
declare a public.attendance;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into a from public.attendance where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'Check-in not found.'); end if;
  if p_action = 'delete' then delete from public.attendance where id = p_id;
  elsif p_action = 'in_range' then update public.attendance set in_range = not in_range where id = p_id;
  elsif p_action = 'late' then update public.attendance set late = not late where id = p_id;
  elsif p_action = 'name' then
    if char_length(trim(coalesce(p_value, ''))) not between 2 and 100 then return json_build_object('ok', false, 'error', 'The name must be 2 to 100 characters.'); end if;
    update public.attendance set student_name = trim(p_value) where id = p_id;
  else return json_build_object('ok', false, 'error', 'Unknown action.'); end if;
  perform public.audit('checkin_edited', a.index_number, p_action);
  return json_build_object('ok', true);
end $$;

-- Add a student to a class by hand.
create or replace function public.admin_add_checkin(p_session uuid, p_index text, p_name text, p_programme text, p_level text) returns json
language plpgsql security definer set search_path to 'public' as $$
declare s public.sessions; idx text := upper(trim(p_index));
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into s from public.sessions where id = p_session;
  if not found then return json_build_object('ok', false, 'error', 'Class not found.'); end if;
  if idx !~ '^[A-Z0-9/\-]{4,30}$' then return json_build_object('ok', false, 'error', 'Enter a valid index number.'); end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then return json_build_object('ok', false, 'error', 'Enter the student name.'); end if;
  insert into public.attendance(session_id, index_number, programme, student_name, level, in_range, manual, note)
  values (s.id, idx, coalesce(nullif(trim(p_programme), ''), s.programme, '-'), trim(p_name), coalesce(nullif(trim(p_level), ''), s.level, '-'), true, true, 'Added by the admin')
  on conflict (session_id, index_number) do nothing;
  if not found then return json_build_object('ok', false, 'error', 'That index number is already in this class.'); end if;
  perform public.audit('checkin_added', idx, s.course);
  return json_build_object('ok', true);
end $$;

-- Correct a wrong index number everywhere (check-ins, rolls, phone alerts). Rows that would clash are left alone and counted.
create or replace function public.admin_fix_index(p_old text, p_new text) returns json
language plpgsql security definer set search_path to 'public' as $$
declare o text := upper(trim(p_old)); n text := upper(trim(p_new)); a int := 0; a_skip int := 0; r int := 0; r_skip int := 0;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if n !~ '^[A-Z0-9/\-]{4,30}$' then return json_build_object('ok', false, 'error', 'The new index number is not valid.'); end if;
  if o = n then return json_build_object('ok', false, 'error', 'The two numbers are the same.'); end if;
  select count(*) into a_skip from public.attendance x where x.index_number = o and exists (select 1 from public.attendance y where y.session_id = x.session_id and y.index_number = n);
  update public.attendance x set index_number = n where x.index_number = o and not exists (select 1 from public.attendance y where y.session_id = x.session_id and y.index_number = n);
  get diagnostics a = row_count;
  select count(*) into r_skip from public.rolls x where x.index_number = o and exists (select 1 from public.rolls y where y.owner = x.owner and y.course = x.course and y.index_number = n);
  update public.rolls x set index_number = n where x.index_number = o and not exists (select 1 from public.rolls y where y.owner = x.owner and y.course = x.course and y.index_number = n);
  get diagnostics r = row_count;
  update public.blocked_attempts set index_number = n where index_number = o;
  perform public.audit('index_corrected', o, 'changed to ' || n);
  return json_build_object('ok', true, 'checkins', a, 'checkins_skipped', a_skip, 'rolls', r, 'rolls_skipped', r_skip);
end $$;

-- Change a student's name everywhere.
create or replace function public.admin_rename_student(p_index text, p_name text) returns json
language plpgsql security definer set search_path to 'public' as $$
declare i text := upper(trim(p_index)); a int; r int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 100 then return json_build_object('ok', false, 'error', 'The name must be 2 to 100 characters.'); end if;
  update public.attendance set student_name = trim(p_name) where index_number = i; get diagnostics a = row_count;
  update public.rolls set student_name = trim(p_name) where index_number = i; get diagnostics r = row_count;
  perform public.audit('student_renamed', i, trim(p_name));
  return json_build_object('ok', true, 'checkins', a, 'rolls', r);
end $$;

-- Health check
create or replace function public.admin_diagnostics() returns json
language plpgsql security definer set search_path to 'public' as $$
declare out jsonb := '[]'::jsonb; n int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select count(*) into n from public.sessions where closes_at > now() + interval '12 hours';
  out := out || jsonb_build_object('key', 'long_open', 'label', 'Classes set to stay open for more than 12 hours from now', 'count', n, 'fix', 'Close them');
  select count(*) into n from public.sessions s where s.created_at < now() - interval '7 days' and not exists (select 1 from public.attendance a where a.session_id = s.id);
  out := out || jsonb_build_object('key', 'empty_classes', 'label', 'Classes older than 7 days with no check-ins', 'count', n, 'fix', 'Move to Trash');
  select count(*) into n from (select distinct r.owner, r.course from public.rolls r where not exists (select 1 from public.courses c where c.owner = r.owner and lower(c.name) = lower(r.course))) x;
  out := out || jsonb_build_object('key', 'rolls_no_course', 'label', 'Class rolls whose course is missing from the lecturer''s course list', 'count', n, 'fix', 'Add the courses');
  select count(*) into n from public.blocked_attempts where status = 'pending' and created_at < now() - interval '7 days';
  out := out || jsonb_build_object('key', 'old_alerts', 'label', 'Phone alerts left undecided for more than 7 days', 'count', n, 'fix', 'Mark as rejected');
  select count(*) into n from public.checkin_attempts where at < now() - interval '1 hour';
  out := out || jsonb_build_object('key', 'old_attempts', 'label', 'Old rate-limit records', 'count', n, 'fix', 'Clear them');
  select count(*) into n from (select index_number from public.attendance where student_name is not null group by index_number having count(distinct lower(trim(student_name))) > 1) x;
  out := out || jsonb_build_object('key', 'name_mismatch', 'label', 'Index numbers that appear under different names (check by hand with Student lookup)', 'count', n, 'fix', null);
  return out::json;
end $$;

create or replace function public.admin_fix(p_kind text) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int := 0;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_kind = 'long_open' then update public.sessions set closes_at = now() where closes_at > now() + interval '12 hours'; get diagnostics n = row_count;
  elsif p_kind = 'empty_classes' then delete from public.sessions s where s.created_at < now() - interval '7 days' and not exists (select 1 from public.attendance a where a.session_id = s.id); get diagnostics n = row_count;
  elsif p_kind = 'rolls_no_course' then
    insert into public.courses(owner, name) select distinct r.owner, r.course from public.rolls r where not exists (select 1 from public.courses c where c.owner = r.owner and lower(c.name) = lower(r.course)) and exists (select 1 from public.profiles p where p.id = r.owner);
    get diagnostics n = row_count;
  elsif p_kind = 'old_alerts' then update public.blocked_attempts set status = 'rejected', decided_at = now() where status = 'pending' and created_at < now() - interval '7 days'; get diagnostics n = row_count;
  elsif p_kind = 'old_attempts' then delete from public.checkin_attempts where at < now() - interval '1 hour'; get diagnostics n = row_count;
  else raise exception 'Unknown fix'; end if;
  perform public.audit('health_fix', p_kind, n || ' item(s)');
  return n;
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_edit_class(uuid,text,text,text,text,text,int,uuid)','admin_edit_checkin(uuid,text,text)','admin_add_checkin(uuid,text,text,text,text)','admin_fix_index(text,text)','admin_rename_student(text,text)','admin_diagnostics()','admin_fix(text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
