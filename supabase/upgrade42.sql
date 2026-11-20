-- upgrade42.sql  (run after upgrade41.sql; safe to run twice)
-- Class desk: start a class for a chosen lecturer, add students by hand as admin, transfer ONE class to ONE lecturer.

create or replace function public.admin_start_class(p_owner uuid, p_course text, p_programme text, p_level text, p_year text, p_sem text,
  p_lat double precision, p_lng double precision, p_radius int, p_minutes int) returns json
language plpgsql security definer set search_path to 'public' as $$
declare alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text; i int; tries int := 0; sid uuid;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if not exists (select 1 from public.profiles where id = p_owner and role <> 'admin' and deleted_at is null) then
    return json_build_object('ok', false, 'error', 'Choose a lecturer or teaching assistant.'); end if;
  if char_length(trim(coalesce(p_course, ''))) not between 2 and 120 then return json_build_object('ok', false, 'error', 'The course name must be 2 to 120 characters.'); end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then return json_build_object('ok', false, 'error', 'Choose a venue or enter a valid position.'); end if;
  if coalesce(p_radius, 0) not between 20 and 2000 then return json_build_object('ok', false, 'error', 'The distance must be 20 to 2000 metres.'); end if;
  if coalesce(p_minutes, 0) not between 1 and 600 then return json_build_object('ok', false, 'error', 'Open for 1 to 600 minutes.'); end if;
  loop
    tries := tries + 1; c := '';
    for i in 1..6 loop c := c || substr(alpha, 1 + floor(random() * length(alpha))::int, 1); end loop;
    begin
      insert into public.sessions(code, owner, teacher_id, course, programme, level, academic_year, semester, lat, lng, radius_m, opens_at, closes_at)
      values (c, p_owner, p_owner, trim(p_course), nullif(trim(coalesce(p_programme, '')), ''), nullif(trim(coalesce(p_level, '')), ''),
              nullif(trim(coalesce(p_year, '')), ''), nullif(trim(coalesce(p_sem, '')), ''), p_lat, p_lng, p_radius, now(), now() + make_interval(mins => p_minutes))
      returning id into sid;
      exit;
    exception when unique_violation then
      if tries > 8 then return json_build_object('ok', false, 'error', 'Could not create a unique code. Try again.'); end if;
    end;
  end loop;
  if not exists (select 1 from public.courses where owner = p_owner and lower(name) = lower(trim(p_course))) then
    insert into public.courses(owner, name) values (p_owner, trim(p_course)); end if;
  perform public.audit('class_started_for', trim(p_course), 'started by admin for ' || (select coalesce(full_name, email) from public.profiles where id = p_owner));
  return json_build_object('ok', true, 'id', sid, 'code', c);
end $$;

create or replace function public.admin_add_student(p_session uuid, p_index text, p_name text, p_programme text, p_level text) returns json
language plpgsql security definer set search_path to 'public' as $$
declare s public.sessions; ix text := upper(trim(coalesce(p_index, '')));
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into s from public.sessions where id = p_session;
  if not found then return json_build_object('ok', false, 'error', 'Class not found.'); end if;
  if char_length(ix) not between 3 and 30 then return json_build_object('ok', false, 'error', 'Enter the index number.'); end if;
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 100 then return json_build_object('ok', false, 'error', 'Enter the full name.'); end if;
  if exists (select 1 from public.attendance where session_id = p_session and upper(index_number) = ix) then
    return json_build_object('ok', false, 'error', ix || ' is already in this class.'); end if;
  insert into public.attendance(session_id, index_number, student_name, programme, level, lat, lng, accuracy_m, distance_m, in_range, manual, note)
  values (p_session, ix, trim(p_name), coalesce(nullif(trim(coalesce(p_programme, '')), ''), s.programme, 'Not stated'), coalesce(nullif(trim(coalesce(p_level, '')), ''), s.level), s.lat, s.lng, 0, 0, true, true, 'Added by admin');
  perform public.audit('admin_added_student', ix, s.course);
  return json_build_object('ok', true);
end $$;

create or replace function public.admin_transfer_class(p_id uuid, p_to uuid, p_copy_roll boolean default false) returns json
language plpgsql security definer set search_path to 'public' as $$
declare s public.sessions; n int := 0; who text;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into s from public.sessions where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'Class not found.'); end if;
  if p_to = s.owner then return json_build_object('ok', false, 'error', 'That lecturer already owns this class.'); end if;
  select coalesce(full_name, email) into who from public.profiles where id = p_to and role <> 'admin' and deleted_at is null;
  if who is null then return json_build_object('ok', false, 'error', 'Choose an active lecturer or teaching assistant.'); end if;
  update public.sessions set owner = p_to, teacher_id = p_to where id = p_id;
  if not exists (select 1 from public.courses where owner = p_to and lower(name) = lower(s.course)) then insert into public.courses(owner, name) values (p_to, s.course); end if;
  if p_copy_roll then
    insert into public.rolls(owner, course, index_number, student_name, programme, level)
    select p_to, r.course, r.index_number, r.student_name, r.programme, r.level from public.rolls r where r.owner = s.owner and lower(r.course) = lower(s.course)
    on conflict (owner, course, index_number) do nothing;
    get diagnostics n = row_count;
  end if;
  perform public.audit('class_transferred', s.course, 'to ' || who || case when p_copy_roll then ' (roll copied: ' || n || ')' else '' end);
  return json_build_object('ok', true, 'to', who, 'roll_copied', n);
end $$;

revoke all on function public.admin_start_class(uuid,text,text,text,text,text,double precision,double precision,int,int) from public, anon;
revoke all on function public.admin_add_student(uuid,text,text,text,text) from public, anon;
revoke all on function public.admin_transfer_class(uuid,uuid,boolean) from public, anon;
grant execute on function public.admin_start_class(uuid,text,text,text,text,text,double precision,double precision,int,int) to authenticated;
grant execute on function public.admin_add_student(uuid,text,text,text,text) to authenticated;
grant execute on function public.admin_transfer_class(uuid,uuid,boolean) to authenticated;
