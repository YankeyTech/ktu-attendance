-- upgrade21.sql  (run after upgrade20.sql; safe to run twice)
-- 1. Admin-managed lists of programmes and levels (the built-in lists stay; the admin adds or hides entries).
-- 2. Class notes: a short note the lecturer can save on each class.

create table if not exists public.catalog (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('programme', 'level')),
  name text not null check (char_length(name) between 2 and 120),
  grp text check (grp is null or char_length(grp) <= 120),
  removed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (kind, name)
);
alter table public.catalog enable row level security;
drop policy if exists "catalog admin all" on public.catalog;
create policy "catalog admin all" on public.catalog for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Everyone (including students who are not signed in) can read the lists through this function only.
create or replace function public.get_catalog()
returns json language sql stable security definer set search_path to 'public' as $$
  select json_build_object(
    'programmes', coalesce((select json_agg(json_build_object('name', name, 'grp', grp, 'removed', removed) order by created_at) from public.catalog where kind = 'programme'), '[]'::json),
    'levels', coalesce((select json_agg(json_build_object('name', name, 'removed', removed) order by created_at) from public.catalog where kind = 'level'), '[]'::json))
$$;
grant execute on function public.get_catalog() to anon, authenticated;

alter table public.sessions add column if not exists notes text;
do $$ begin
  alter table public.sessions add constraint sessions_notes_check check (notes is null or char_length(notes) <= 2000);
exception when duplicate_object then null; end $$;
