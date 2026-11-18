-- upgrade28.sql  (run after upgrade27.sql; safe to run twice)
-- Per-lecturer permissions, private messages from the admin to one lecturer, and database size / counts for the admin.

alter table public.profiles add column if not exists perms jsonb not null default '{}'::jsonb;
alter table public.announcements add column if not exists target uuid;

-- A notice with a target is visible only to that person (and the admin).
drop policy if exists "staff read announcements" on public.announcements;
create policy "staff read announcements" on public.announcements for select to authenticated
  using (public.is_admin() or (expires_at > now() and (target is null or target = auth.uid())));

-- Permissions are on unless the admin switched them off. max_minutes is a number (longest class a lecturer may open).
create or replace function public.has_perm(p_uid uuid, p_key text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select (perms->>p_key) <> 'false' from public.profiles where id = p_uid), true);
$$;

create or replace function public.perm_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare mx numeric; mins numeric;
begin
  if auth.uid() is null or public.is_admin() then return coalesce(new, old); end if;
  if tg_table_name = 'rolls' and tg_op = 'INSERT' and not public.has_perm(auth.uid(), 'upload_rolls') then
    raise exception 'The admin has turned off class roll uploads for your account. Contact the admin.'; end if;
  if tg_table_name = 'rolls' and tg_op = 'DELETE' and not public.has_perm(auth.uid(), 'delete_rolls') then
    raise exception 'The admin has turned off deleting class rolls for your account. Contact the admin.'; end if;
  if tg_table_name = 'venues' and tg_op = 'INSERT' and not public.has_perm(auth.uid(), 'save_venues') then
    raise exception 'The admin has turned off saving venues for your account. Contact the admin.'; end if;
  if tg_table_name = 'sessions' and tg_op = 'INSERT' then
    select nullif(perms->>'max_minutes', '')::numeric into mx from public.profiles where id = auth.uid();
    if mx is not null and new.closes_at is not null then
      mins := extract(epoch from (new.closes_at - coalesce(new.opens_at, now()))) / 60;
      if mins > mx + 1 then raise exception 'The admin allows classes of up to % minutes for your account.', mx::int; end if;
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_perm_rolls_ins on public.rolls;
create trigger trg_perm_rolls_ins before insert on public.rolls for each row execute function public.perm_guard();
drop trigger if exists trg_perm_rolls_del on public.rolls;
create trigger trg_perm_rolls_del before delete on public.rolls for each row execute function public.perm_guard();
drop trigger if exists trg_perm_venues on public.venues;
create trigger trg_perm_venues before insert on public.venues for each row execute function public.perm_guard();
drop trigger if exists trg_perm_sessions on public.sessions;
create trigger trg_perm_sessions before insert on public.sessions for each row execute function public.perm_guard();

create or replace function public.admin_set_perms(p_id uuid, p_perms jsonb) returns json
language plpgsql security definer set search_path to 'public' as $$
declare clean jsonb := '{}'::jsonb; k text;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  foreach k in array array['upload_rolls','delete_rolls','save_venues'] loop
    if p_perms ? k and (p_perms->>k) = 'false' then clean := clean || jsonb_build_object(k, 'false'); end if;
  end loop;
  if p_perms ? 'max_minutes' and (p_perms->>'max_minutes') ~ '^[0-9]{1,4}$' and (p_perms->>'max_minutes')::int between 5 and 1440 then
    clean := clean || jsonb_build_object('max_minutes', (p_perms->>'max_minutes')::int);
  end if;
  update public.profiles set perms = clean where id = p_id and role <> 'admin';
  perform public.audit('permissions_changed', (select email from public.profiles where id = p_id), clean::text);
  return json_build_object('ok', true, 'perms', clean);
end $$;

create or replace function public.admin_system_stats() returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return json_build_object('db_bytes', pg_database_size(current_database()), 'sessions', (select count(*) from public.sessions),
    'attendance', (select count(*) from public.attendance), 'rolls', (select count(*) from public.rolls),
    'staff', (select count(*) from public.profiles), 'trash', (select count(*) from public.trash), 'audit', (select count(*) from public.audit_log));
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_set_perms(uuid,jsonb)','admin_system_stats()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
