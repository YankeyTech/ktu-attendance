-- upgrade31.sql  (run after upgrade30.sql; safe to run twice)
-- Excused absences, shared-phone report across all classes, lecturer activity scorecard.

create table if not exists public.excuses (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions(id) on delete cascade,
  index_number text not null,
  student_name text,
  reason       text,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  unique (session_id, index_number)
);
alter table public.excuses enable row level security;
drop policy if exists "lecturer manages own excuses" on public.excuses;
create policy "lecturer manages own excuses" on public.excuses for all to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and s.teacher_id = auth.uid()))
  with check (exists (select 1 from public.sessions s where s.id = session_id and s.teacher_id = auth.uid()));
drop policy if exists "admin manages excuses" on public.excuses;
create policy "admin manages excuses" on public.excuses for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.excuses to authenticated;

-- Phones that checked in more than one index number in the last N days, across every class.
create or replace function public.admin_shared_devices(p_days int default 30) returns table(device text, students int, indexes text[], names text[], classes int, last_at timestamptz)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return query
    select a.device_id, count(distinct a.index_number)::int,
           array_agg(distinct a.index_number), array_agg(distinct coalesce(a.student_name, a.index_number)),
           count(distinct a.session_id)::int, max(a.checked_in_at)
    from public.attendance a
    where a.device_id is not null and a.checked_in_at > now() - make_interval(days => greatest(1, least(p_days, 365)))
    group by a.device_id having count(distinct a.index_number) > 1
    order by count(distinct a.index_number) desc, max(a.checked_in_at) desc limit 200;
end $$;

-- One row per lecturer: classes and check-ins in the last N days, and when they were last seen.
create or replace function public.admin_lecturer_activity(p_days int default 30) returns table(id uuid, classes int, checkins int, last_class timestamptz, last_seen timestamptz)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return query
    select p.id,
      (select count(*)::int from public.sessions s where s.teacher_id = p.id and s.created_at > now() - make_interval(days => greatest(1, least(p_days, 365)))),
      (select count(*)::int from public.attendance a join public.sessions s on s.id = a.session_id where s.teacher_id = p.id and a.checked_in_at > now() - make_interval(days => greatest(1, least(p_days, 365)))),
      (select max(s.created_at) from public.sessions s where s.teacher_id = p.id),
      p.last_seen_at
    from public.profiles p where p.role <> 'admin' and p.deleted_at is null;
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_shared_devices(int)','admin_lecturer_activity(int)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
