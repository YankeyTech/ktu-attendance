-- upgrade29.sql  (run after upgrade28.sql; safe to run twice)
-- Messages between a lecturer and the admin, and "last seen" for staff accounts.

alter table public.profiles add column if not exists last_seen_at timestamptz;

create or replace function public.touch_seen() returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return; end if;
  update public.profiles set last_seen_at = now() where id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
end $$;
revoke all on function public.touch_seen() from public, anon;
grant execute on function public.touch_seen() to authenticated;

create table if not exists public.staff_messages (
  id            uuid primary key default gen_random_uuid(),
  thread_owner  uuid not null references public.profiles(id) on delete cascade,
  sender        text not null check (sender in ('staff','admin')),
  body          text not null check (char_length(body) between 2 and 1000),
  created_at    timestamptz not null default now(),
  read_by_admin boolean not null default false,
  read_by_staff boolean not null default false
);
create index if not exists staff_messages_owner_idx on public.staff_messages(thread_owner, created_at);
alter table public.staff_messages enable row level security;

drop policy if exists "read own thread" on public.staff_messages;
create policy "read own thread" on public.staff_messages for select to authenticated using (public.is_admin() or thread_owner = auth.uid());
drop policy if exists "staff write" on public.staff_messages;
create policy "staff write" on public.staff_messages for insert to authenticated
  with check (sender = 'staff' and thread_owner = auth.uid() and read_by_admin = false and read_by_staff = true);
drop policy if exists "admin all messages" on public.staff_messages;
create policy "admin all messages" on public.staff_messages for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.staff_messages to authenticated;

-- A lecturer may send at most 20 messages an hour.
create or replace function public.msg_limit() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.sender = 'staff' and (select count(*) from public.staff_messages where thread_owner = new.thread_owner and sender = 'staff' and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many messages. Try again later.';
  end if;
  return new;
end $$;
drop trigger if exists trg_msg_limit on public.staff_messages;
create trigger trg_msg_limit before insert on public.staff_messages for each row execute function public.msg_limit();

-- Lecturer marks the admin's replies as read.
create or replace function public.staff_mark_read() returns void
language sql security definer set search_path to 'public' as $$
  update public.staff_messages set read_by_staff = true where thread_owner = auth.uid() and sender = 'admin' and not read_by_staff;
$$;
revoke all on function public.staff_mark_read() from public, anon;
grant execute on function public.staff_mark_read() to authenticated;
