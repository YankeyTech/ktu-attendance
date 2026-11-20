-- upgrade38.sql  (run after upgrade37.sql; safe to run twice)
-- Bulk permissions, block many students at once, private admin notes about a lecturer, and a planned number of classes per course.

alter table public.courses add column if not exists planned_classes int;

create or replace function public.set_course_plan(p_course text, p_n int) returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_n is not null and (p_n < 1 or p_n > 200) then return json_build_object('ok', false, 'error', 'Use a number from 1 to 200.'); end if;
  update public.courses set planned_classes = p_n where owner = auth.uid() and lower(name) = lower(trim(p_course));
  return json_build_object('ok', true);
end $$;
revoke all on function public.set_course_plan(text,int) from public, anon;
grant execute on function public.set_course_plan(text,int) to authenticated;

-- p_perms: key -> true (allowed again) or false (switched off). max_minutes: a number, or 0 to remove the limit.
create or replace function public.admin_bulk_perms(p_ids uuid[], p_perms jsonb) returns json
language plpgsql security definer set search_path to 'public' as $$
declare k text; n int := 0; uid uuid; cur jsonb;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then return json_build_object('ok', false, 'error', 'Choose at least one person.'); end if;
  foreach uid in array p_ids loop
    select coalesce(perms, '{}'::jsonb) into cur from public.profiles where profiles.id = uid and role <> 'admin';
    if not found then continue; end if;
    foreach k in array array['upload_rolls','delete_rolls','save_venues','start_classes','manual_add','edit_checkins'] loop
      if p_perms ? k then
        if (p_perms->>k) = 'false' then cur := cur || jsonb_build_object(k, 'false'); else cur := cur - k; end if;
      end if;
    end loop;
    if p_perms ? 'max_minutes' and (p_perms->>'max_minutes') ~ '^[0-9]{1,4}$' then
      if (p_perms->>'max_minutes')::int = 0 then cur := cur - 'max_minutes';
      elsif (p_perms->>'max_minutes')::int between 5 and 1440 then cur := cur || jsonb_build_object('max_minutes', (p_perms->>'max_minutes')::int); end if;
    end if;
    update public.profiles set perms = cur where profiles.id = uid; n := n + 1;
  end loop;
  perform public.audit('bulk_permissions', n || ' people', p_perms::text);
  return json_build_object('ok', true, 'count', n);
end $$;
revoke all on function public.admin_bulk_perms(uuid[],jsonb) from public, anon;
grant execute on function public.admin_bulk_perms(uuid[],jsonb) to authenticated;

create or replace function public.admin_block_many(p_values text[], p_reason text) returns json
language plpgsql security definer set search_path to 'public' as $$
declare v text; n int := 0;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(array_length(p_values, 1), 0) > 500 then return json_build_object('ok', false, 'error', 'Paste at most 500 index numbers at a time.'); end if;
  foreach v in array coalesce(p_values, '{}') loop
    v := upper(btrim(v));
    if v ~ '^[A-Z0-9/\-]{4,30}$' then
      insert into public.blocked_students(kind, value, reason) values ('index', v, left(coalesce(p_reason, ''), 200)) on conflict (kind, value) do nothing;
      if found then n := n + 1; end if;
    end if;
  end loop;
  perform public.audit('students_blocked', n || ' index numbers', left(coalesce(p_reason, ''), 200));
  return json_build_object('ok', true, 'count', n);
end $$;
revoke all on function public.admin_block_many(text[],text) from public, anon;
grant execute on function public.admin_block_many(text[],text) to authenticated;

-- Private notes the admin keeps about a lecturer. Nobody else can read them.
create table if not exists public.admin_notes (owner uuid primary key, note text not null default '', updated_at timestamptz not null default now());
alter table public.admin_notes enable row level security;
revoke all on public.admin_notes from anon, authenticated;
create or replace function public.admin_get_note(p_id uuid) returns text
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return coalesce((select note from public.admin_notes where owner = p_id), '');
end $$;
create or replace function public.admin_set_note(p_id uuid, p_note text) returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  insert into public.admin_notes(owner, note) values (p_id, left(coalesce(p_note, ''), 2000)) on conflict (owner) do update set note = excluded.note, updated_at = now();
  return json_build_object('ok', true);
end $$;
do $$ declare f text; begin
  foreach f in array array['admin_get_note(uuid)','admin_set_note(uuid,text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
