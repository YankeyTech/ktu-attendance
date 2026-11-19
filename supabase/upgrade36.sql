-- upgrade36.sql  (run after upgrade35.sql; safe to run twice)
-- Bulk class actions for the admin, and three more per-lecturer permissions.

create or replace function public.admin_bulk_classes(p_ids uuid[], p_action text, p_owner uuid default null, p_year text default null, p_sem text default null) returns json
language plpgsql security definer set search_path to 'public' as $$
declare n int := 0;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then return json_build_object('ok', false, 'error', 'No classes chosen.'); end if;
  if array_length(p_ids, 1) > 2000 then return json_build_object('ok', false, 'error', 'Choose at most 2000 classes at a time.'); end if;
  if p_action = 'move' then
    if p_owner is null or not exists (select 1 from public.profiles where id = p_owner and role <> 'admin' and deleted_at is null) then return json_build_object('ok', false, 'error', 'Choose a lecturer.'); end if;
    insert into public.courses(owner, name) select distinct p_owner, s.course from public.sessions s
      where s.id = any(p_ids) and not exists (select 1 from public.courses c where c.owner = p_owner and lower(c.name) = lower(s.course));
    update public.sessions set owner = p_owner, teacher_id = p_owner where id = any(p_ids); get diagnostics n = row_count;
    perform public.audit('bulk_move', n || ' classes', (select email from public.profiles where id = p_owner));
  elsif p_action = 'term' then
    update public.sessions set academic_year = nullif(trim(coalesce(p_year, '')), ''), semester = nullif(trim(coalesce(p_sem, '')), '') where id = any(p_ids); get diagnostics n = row_count;
    perform public.audit('bulk_term', n || ' classes', coalesce(p_year, '') || ' ' || coalesce(p_sem, ''));
  elsif p_action = 'delete' then
    delete from public.sessions where id = any(p_ids); get diagnostics n = row_count;
    perform public.audit('bulk_delete', n || ' classes', 'moved to the Trash');
  else
    return json_build_object('ok', false, 'error', 'Unknown action.');
  end if;
  return json_build_object('ok', true, 'count', n);
end $$;
revoke all on function public.admin_bulk_classes(uuid[],text,uuid,text,text) from public, anon;
grant execute on function public.admin_bulk_classes(uuid[],text,uuid,text,text) to authenticated;

-- More permissions the admin can switch off for one lecturer.
create or replace function public.admin_set_perms(p_id uuid, p_perms jsonb) returns json
language plpgsql security definer set search_path to 'public' as $$
declare clean jsonb := '{}'::jsonb; k text;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  foreach k in array array['upload_rolls','delete_rolls','save_venues','start_classes','manual_add','edit_checkins'] loop
    if p_perms ? k and (p_perms->>k) = 'false' then clean := clean || jsonb_build_object(k, 'false'); end if;
  end loop;
  if p_perms ? 'max_minutes' and (p_perms->>'max_minutes') ~ '^[0-9]{1,4}$' and (p_perms->>'max_minutes')::int between 5 and 1440 then
    clean := clean || jsonb_build_object('max_minutes', (p_perms->>'max_minutes')::int);
  end if;
  update public.profiles set perms = clean where id = p_id and role <> 'admin';
  perform public.audit('permissions_changed', (select email from public.profiles where id = p_id), clean::text);
  return json_build_object('ok', true, 'perms', clean);
end $$;

create or replace function public.perm_guard2() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if tg_table_name = 'sessions' and not public.has_perm(auth.uid(), 'start_classes') then
    raise exception 'The admin has turned off starting classes for your account. Contact the admin.'; end if;
  if tg_table_name = 'attendance' and coalesce(to_jsonb(new)->>'manual', 'false') = 'true' and not public.has_perm(auth.uid(), 'manual_add') then
    raise exception 'The admin has turned off adding students by hand for your account. Contact the admin.'; end if;
  return new;
end $$;
drop trigger if exists trg_perm2_sessions on public.sessions;
create trigger trg_perm2_sessions before insert on public.sessions for each row execute function public.perm_guard2();
drop trigger if exists trg_perm2_attendance on public.attendance;
create trigger trg_perm2_attendance before insert on public.attendance for each row execute function public.perm_guard2();

create or replace function public.edit_checkin(p_id uuid, p_index text, p_name text) returns json
language plpgsql security definer set search_path to 'public' as $$
declare a record; i text := upper(trim(coalesce(p_index, ''))); n text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  select t.*, s.teacher_id as s_teacher, s.owner as s_owner into a from public.attendance t join public.sessions s on s.id = t.session_id where t.id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'Check-in not found.'); end if;
  if not (public.is_admin() or a.s_teacher = auth.uid() or a.s_owner = auth.uid()) then return json_build_object('ok', false, 'error', 'This is not your class.'); end if;
  if not public.is_admin() and not public.has_perm(auth.uid(), 'edit_checkins') then return json_build_object('ok', false, 'error', 'The admin has turned off editing check-ins for your account.'); end if;
  if i !~ '^[A-Z0-9/\-]{4,30}$' then return json_build_object('ok', false, 'error', 'Enter a valid index number.'); end if;
  if char_length(n) < 3 or char_length(n) > 100 then return json_build_object('ok', false, 'error', 'Enter the full name.'); end if;
  if i <> upper(a.index_number) and exists (select 1 from public.attendance where session_id = a.session_id and upper(index_number) = i and id <> p_id) then
    return json_build_object('ok', false, 'error', 'That index number is already in this class.');
  end if;
  update public.attendance set index_number = i, student_name = n, note = coalesce(note, 'Details corrected by lecturer') where id = p_id;
  perform public.audit('checkin_edited', a.index_number || ' -> ' || i, n);
  return json_build_object('ok', true);
end $$;
