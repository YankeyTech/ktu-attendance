-- upgrade44.sql  (run after upgrade43.sql; safe to run twice)
-- Move check-ins between classes, and tidy index numbers.

create or replace function public.admin_move_checkins(p_from uuid, p_to uuid, p_ids uuid[] default null) returns json
language plpgsql security definer set search_path to 'public' as $$
declare n int; skipped int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_from is null or p_to is null or p_from = p_to then return json_build_object('ok', false, 'error', 'Choose two different classes.'); end if;
  if not exists (select 1 from public.sessions where id = p_from) or not exists (select 1 from public.sessions where id = p_to) then
    return json_build_object('ok', false, 'error', 'Class not found.'); end if;
  select count(*) into skipped from public.attendance a
    where a.session_id = p_from and (p_ids is null or a.id = any(p_ids))
      and exists (select 1 from public.attendance b where b.session_id = p_to and upper(b.index_number) = upper(a.index_number));
  update public.attendance a set session_id = p_to
    where a.session_id = p_from and (p_ids is null or a.id = any(p_ids))
      and not exists (select 1 from public.attendance b where b.session_id = p_to and upper(b.index_number) = upper(a.index_number));
  get diagnostics n = row_count;
  perform public.audit('checkins_moved', n || ' check-ins', (select course from public.sessions where id = p_from) || ' to ' || (select course from public.sessions where id = p_to));
  return json_build_object('ok', true, 'moved', n, 'skipped', skipped);
end $$;

create or replace function public.admin_fix_indexes(p_dry boolean default true) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_dry then
    select count(*) into n from public.attendance a where a.index_number <> upper(btrim(a.index_number))
      and not exists (select 1 from public.attendance b where b.session_id = a.session_id and b.id <> a.id and b.index_number = upper(btrim(a.index_number)));
    return n;
  end if;
  update public.attendance a set index_number = upper(btrim(a.index_number)) where a.index_number <> upper(btrim(a.index_number))
    and not exists (select 1 from public.attendance b where b.session_id = a.session_id and b.id <> a.id and b.index_number = upper(btrim(a.index_number)));
  get diagnostics n = row_count;
  perform public.audit('indexes_fixed', n || ' index numbers tidied', null);
  return n;
end $$;

revoke all on function public.admin_move_checkins(uuid,uuid,uuid[]) from public, anon;
revoke all on function public.admin_fix_indexes(boolean) from public, anon;
grant execute on function public.admin_move_checkins(uuid,uuid,uuid[]) to authenticated;
grant execute on function public.admin_fix_indexes(boolean) to authenticated;
