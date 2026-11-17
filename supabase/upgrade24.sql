-- upgrade24.sql  (run after upgrade23.sql; safe to run twice)
-- Announcements: the admin posts a notice that every lecturer and teaching assistant sees on their Home tab.

create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  message    text not null check (char_length(message) between 3 and 500),
  kind       text not null default 'info' check (kind in ('info','warn')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_by uuid default auth.uid()
);
alter table public.announcements enable row level security;

drop policy if exists "staff read announcements" on public.announcements;
create policy "staff read announcements" on public.announcements for select to authenticated
  using (expires_at > now() or public.is_admin());
drop policy if exists "admin writes announcements" on public.announcements;
create policy "admin writes announcements" on public.announcements for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.announcements to authenticated;
