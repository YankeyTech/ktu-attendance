-- upgrade22.sql  (run after upgrade21.sql; safe to run twice)
-- Trash: everything a lecturer or the admin deletes is kept for 90 days. The admin can restore it or delete it for good.

alter table public.profiles add column if not exists deleted_at timestamptz;

create table if not exists public.trash (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('class','roll','checkins','course','venue')),
  label      text not null,
  detail     text,
  owner      uuid,
  deleted_by uuid,
  deleted_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days',
  payload    jsonb not null
);
create index if not exists trash_expires_idx on public.trash(expires_at);
alter table public.trash enable row level security;   -- no policies: only the functions below can read it
revoke all on public.trash from anon, authenticated;

-- Only keep things for accounts that exist and are not themselves in the trash.
create or replace function public.trash_ok(p_owner uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.profiles where id = p_owner and deleted_at is null);
$$;

-- A class, with all its attendance
create or replace function public.trash_class() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare n int; att jsonb;
begin
  if not public.trash_ok(old.owner) then return old; end if;
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb), count(*) into att, n from public.attendance a where a.session_id = old.id;
  insert into public.trash(kind, label, detail, owner, deleted_by, payload)
  values ('class', old.course || ' (' || to_char(old.created_at, 'DD Mon YYYY') || ')',
          n || ' check-in(s)' || case when old.combined then ', combined class' else coalesce(', ' || old.programme, '') || coalesce(' ' || old.level, '') end,
          old.owner, auth.uid(), jsonb_build_object('session', to_jsonb(old), 'attendance', att));
  return old;
end $$;
drop trigger if exists trg_trash_class on public.sessions;
create trigger trg_trash_class before delete on public.sessions for each row execute function public.trash_class();

-- Check-ins removed one by one (not when the whole class is deleted)
create or replace function public.trash_checkins() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.trash(kind, label, detail, owner, deleted_by, payload)
  select 'checkins', count(*) || ' check-in(s) removed from ' || s.course || ' (' || to_char(s.created_at, 'DD Mon YYYY') || ')',
         left(string_agg(coalesce(o.student_name, '') || ' ' || o.index_number, ', '), 300), s.owner, auth.uid(),
         jsonb_build_object('rows', jsonb_agg(to_jsonb(o)))
  from old_rows o join public.sessions s on s.id = o.session_id
  where public.trash_ok(s.owner)
  group by s.id, s.course, s.created_at, s.owner;
  return null;
end $$;
drop trigger if exists trg_trash_checkins on public.attendance;
create trigger trg_trash_checkins after delete on public.attendance referencing old table as old_rows for each statement execute function public.trash_checkins();

-- Class rolls: one item per lecturer, course, programme and level
create or replace function public.trash_rolls() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.trash(kind, label, detail, owner, deleted_by, payload)
  select 'roll', o.course || ' roll: ' || coalesce(nullif(trim(o.programme), ''), 'no programme') || ' ' || coalesce(nullif(trim(o.level), ''), ''),
         count(*) || ' student(s)', o.owner, auth.uid(), jsonb_build_object('rows', jsonb_agg(to_jsonb(o)))
  from old_rows o where public.trash_ok(o.owner)
  group by o.owner, o.course, coalesce(o.programme, ''), o.programme, coalesce(o.level, ''), o.level;
  return null;
end $$;
drop trigger if exists trg_trash_rolls on public.rolls;
create trigger trg_trash_rolls after delete on public.rolls referencing old table as old_rows for each statement execute function public.trash_rolls();

-- Courses and venues
create or replace function public.trash_simple() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.trash_ok(old.owner) then return old; end if;
  insert into public.trash(kind, label, owner, deleted_by, payload)
  values (tg_argv[0], old.name, old.owner, auth.uid(), jsonb_build_object('row', to_jsonb(old)));
  return old;
end $$;
drop trigger if exists trg_trash_course on public.courses;
create trigger trg_trash_course before delete on public.courses for each row execute function public.trash_simple('course');
drop trigger if exists trg_trash_venue on public.venues;
create trigger trg_trash_venue before delete on public.venues for each row execute function public.trash_simple('venue');

-- Admin: list (also clears out anything older than 90 days)
create or replace function public.admin_trash_list()
returns table(id uuid, kind text, label text, detail text, owner uuid, owner_name text, deleted_by_name text, deleted_at timestamptz, expires_at timestamptz)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  delete from public.trash t where t.expires_at < now();
  return query
    select t.id, t.kind, t.label, t.detail, t.owner,
           coalesce(po.full_name || ' (' || po.email || ')', po.email, 'Unknown'),
           coalesce(pd.full_name, pd.email, 'Unknown'), t.deleted_at, t.expires_at
    from public.trash t left join public.profiles po on po.id = t.owner left join public.profiles pd on pd.id = t.deleted_by
    order by t.deleted_at desc;
end $$;

-- Admin: put an item back
create or replace function public.restore_trash(p_id uuid) returns json
language plpgsql security definer set search_path to 'public' as $$
declare t public.trash; s public.sessions; n int := 0; code2 text;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into t from public.trash where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'That item is no longer in the trash.'); end if;
  if not exists (select 1 from public.profiles where id = t.owner and deleted_at is null) then
    return json_build_object('ok', false, 'error', 'The lecturer account is not active. Restore the account first.');
  end if;
  if t.kind = 'class' then
    s := jsonb_populate_record(null::public.sessions, t.payload->'session');
    if exists (select 1 from public.sessions where code = s.code) then
      loop
        code2 := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
        exit when not exists (select 1 from public.sessions where code = code2);
      end loop;
      s.code := code2;
    end if;
    insert into public.sessions select (s).*;
    insert into public.attendance select * from jsonb_populate_recordset(null::public.attendance, t.payload->'attendance') on conflict do nothing;
    get diagnostics n = row_count;
  elsif t.kind = 'checkins' then
    if not exists (select 1 from public.sessions where id = ((t.payload->'rows'->0)->>'session_id')::uuid) then
      return json_build_object('ok', false, 'error', 'The class these check-ins belonged to no longer exists.');
    end if;
    insert into public.attendance select * from jsonb_populate_recordset(null::public.attendance, t.payload->'rows') on conflict do nothing;
    get diagnostics n = row_count;
  elsif t.kind = 'roll' then
    insert into public.rolls select * from jsonb_populate_recordset(null::public.rolls, t.payload->'rows') on conflict do nothing;
    get diagnostics n = row_count;
  elsif t.kind = 'course' then
    insert into public.courses select * from jsonb_populate_record(null::public.courses, t.payload->'row') on conflict do nothing;
  elsif t.kind = 'venue' then
    insert into public.venues select * from jsonb_populate_record(null::public.venues, t.payload->'row') on conflict do nothing;
  end if;
  delete from public.trash where id = p_id;
  perform public.audit('trash_restored', t.label, t.kind);
  return json_build_object('ok', true, 'label', t.label);
end $$;

-- Admin: delete for good (null = everything in the trash)
create or replace function public.purge_trash(p_ids uuid[]) returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  delete from public.trash where p_ids is null or id = any(p_ids);
  get diagnostics n = row_count;
  perform public.audit('trash_purged', n || ' item(s)', 'trash');
  return n;
end $$;

revoke all on function public.admin_trash_list() from public, anon;
revoke all on function public.restore_trash(uuid) from public, anon;
revoke all on function public.purge_trash(uuid[]) from public, anon;
grant execute on function public.admin_trash_list() to authenticated;
grant execute on function public.restore_trash(uuid) to authenticated;
grant execute on function public.purge_trash(uuid[]) to authenticated;
