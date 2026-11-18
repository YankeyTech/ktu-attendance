-- upgrade26.sql  (run after upgrade25.sql; safe to run twice)
-- Shared venues: the admin saves lecture rooms once (with GPS position and radius) and every lecturer can pick them.

create table if not exists public.shared_venues (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 2 and 80),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  radius_m   int check (radius_m is null or radius_m between 20 and 2000),
  created_at timestamptz not null default now()
);
alter table public.shared_venues enable row level security;
drop policy if exists "staff read shared venues" on public.shared_venues;
create policy "staff read shared venues" on public.shared_venues for select to authenticated using (true);
drop policy if exists "admin writes shared venues" on public.shared_venues;
create policy "admin writes shared venues" on public.shared_venues for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.shared_venues to authenticated;
