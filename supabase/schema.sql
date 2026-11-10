-- Run this whole file once in Supabase: SQL Editor > New query > paste > Run.

create extension if not exists pgcrypto;

-- A "session" is one class meeting that a lecturer opens.
create table if not exists public.sessions (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course     text not null check (char_length(course) between 2 and 120),
  lat        double precision not null,
  lng        double precision not null,
  radius_m   int not null default 100 check (radius_m between 20 and 2000),
  opens_at   timestamptz not null default now(),
  closes_at  timestamptz not null,
  created_at timestamptz not null default now()
);

-- One row per student per session.
create table if not exists public.attendance (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.sessions(id) on delete cascade,
  index_number  text not null,
  programme     text not null,
  lat           double precision,
  lng           double precision,
  accuracy_m    double precision,
  distance_m    double precision,
  in_range      boolean not null,
  checked_in_at timestamptz not null default now(),
  unique (session_id, index_number)
);

create index if not exists attendance_session_idx on public.attendance(session_id);
create index if not exists sessions_teacher_idx on public.sessions(teacher_id, created_at desc);

-- Row Level Security: students (anon) cannot read or write the tables directly.
alter table public.sessions   enable row level security;
alter table public.attendance enable row level security;

drop policy if exists "lecturer manages own sessions" on public.sessions;
create policy "lecturer manages own sessions" on public.sessions
  for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

drop policy if exists "lecturer reads own attendance" on public.attendance;
create policy "lecturer reads own attendance" on public.attendance
  for select to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and s.teacher_id = auth.uid()));

drop policy if exists "lecturer deletes own attendance" on public.attendance;
create policy "lecturer deletes own attendance" on public.attendance
  for delete to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and s.teacher_id = auth.uid()));

-- Distance between two GPS points in metres.
create or replace function public.haversine_m(lat1 double precision, lng1 double precision,
                                              lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

-- Students use this to see the course name for a code. It returns nothing else.
create or replace function public.get_session(p_code text)
returns table(course text, is_open boolean)
language sql security definer set search_path = public as $$
  select s.course, (now() between s.opens_at and s.closes_at)
  from public.sessions s
  where s.code = upper(trim(p_code));
$$;

-- Students use this to check in. Runs with elevated rights, so it validates everything itself.
create or replace function public.check_in(p_code text, p_index text, p_programme text,
                                           p_lat double precision, p_lng double precision,
                                           p_accuracy double precision)
returns json language plpgsql security definer set search_path = public as $$
declare
  s   public.sessions;
  idx text := upper(trim(p_index));
  d   double precision;
  ok  boolean;
begin
  select * into s from public.sessions where code = upper(trim(p_code));
  if not found then
    return json_build_object('ok', false, 'error', 'Class code not found. Check it and try again.');
  end if;
  if now() < s.opens_at or now() > s.closes_at then
    return json_build_object('ok', false, 'error', 'This class check-in is closed.');
  end if;
  if idx !~ '^[A-Z0-9/\-]{4,30}$' then
    return json_build_object('ok', false, 'error', 'Enter a valid index number.');
  end if;
  if p_programme is null or char_length(trim(p_programme)) not between 2 and 120 then
    return json_build_object('ok', false, 'error', 'Choose your programme.');
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    return json_build_object('ok', false, 'error', 'Location is required to check in.');
  end if;

  d  := public.haversine_m(s.lat, s.lng, p_lat, p_lng);
  -- Allow for GPS error, capped at 50 m, so honest students are not rejected indoors.
  ok := d <= s.radius_m + least(coalesce(p_accuracy, 0), 50);

  begin
    insert into public.attendance(session_id, index_number, programme, lat, lng, accuracy_m, distance_m, in_range)
    values (s.id, idx, trim(p_programme), p_lat, p_lng, p_accuracy, d, ok);
  exception when unique_violation then
    return json_build_object('ok', false, 'error', 'This index number has already checked in.');
  end;

  return json_build_object('ok', true, 'in_range', ok, 'course', s.course, 'distance_m', round(d));
end;
$$;

revoke all on function public.get_session(text) from public;
revoke all on function public.check_in(text, text, text, double precision, double precision, double precision) from public;
grant execute on function public.get_session(text) to anon, authenticated;
grant execute on function public.check_in(text, text, text, double precision, double precision, double precision) to anon, authenticated;
