-- upgrade34.sql  (run after upgrade33.sql; safe to run twice)
-- 1) Lecturers can correct the name and index number of a checked-in student.
-- 2) The admin gets an email for every new problem report (needs the notify-report Edge Function).

create or replace function public.edit_checkin(p_id uuid, p_index text, p_name text) returns json
language plpgsql security definer set search_path to 'public' as $$
declare a record; i text := upper(trim(coalesce(p_index, ''))); n text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  select t.*, s.teacher_id as s_teacher, s.owner as s_owner into a from public.attendance t join public.sessions s on s.id = t.session_id where t.id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'Check-in not found.'); end if;
  if not (public.is_admin() or a.s_teacher = auth.uid() or a.s_owner = auth.uid()) then return json_build_object('ok', false, 'error', 'This is not your class.'); end if;
  if i !~ '^[A-Z0-9/\-]{4,30}$' then return json_build_object('ok', false, 'error', 'Enter a valid index number.'); end if;
  if char_length(n) < 3 or char_length(n) > 100 then return json_build_object('ok', false, 'error', 'Enter the full name.'); end if;
  if i <> upper(a.index_number) and exists (select 1 from public.attendance where session_id = a.session_id and upper(index_number) = i and id <> p_id) then
    return json_build_object('ok', false, 'error', 'That index number is already in this class.');
  end if;
  update public.attendance set index_number = i, student_name = n, note = coalesce(note, 'Details corrected by lecturer') where id = p_id;
  perform public.audit('checkin_edited', a.index_number || ' -> ' || i, n);
  return json_build_object('ok', true);
end $$;
revoke all on function public.edit_checkin(uuid,text,text) from public, anon;
grant execute on function public.edit_checkin(uuid,text,text) to authenticated;

do $$ begin create extension if not exists pg_net with schema extensions; exception when others then null; end $$;

create or replace function public.admin_set_notify(p_url text, p_secret text, p_on boolean) returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  insert into public.app_settings(key, value) values ('notify_url', trim(coalesce(p_url, ''))) on conflict (key) do update set value = excluded.value, updated_at = now();
  if coalesce(p_secret, '') <> '' then
    insert into public.app_settings(key, value) values ('notify_secret', trim(p_secret)) on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  insert into public.app_settings(key, value) values ('notify_on', case when p_on then '1' else '0' end) on conflict (key) do update set value = excluded.value, updated_at = now();
  return public.admin_get_notify();
end $$;

create or replace function public.admin_get_notify() returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return json_build_object('url', coalesce(public.app_setting('notify_url'), ''), 'on', coalesce(public.app_setting('notify_on'), '') = '1',
                           'has_secret', coalesce(public.app_setting('notify_secret'), '') <> '',
                           'net', exists (select 1 from pg_extension where extname = 'pg_net'));
end $$;

create or replace function public.send_notify(p_body jsonb) returns void
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare u text := public.app_setting('notify_url'); sec text := public.app_setting('notify_secret');
begin
  if coalesce(public.app_setting('notify_on'), '') <> '1' or coalesce(u, '') = '' or coalesce(sec, '') = '' then return; end if;
  begin
    perform net.http_post(url := u, body := p_body, headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', sec));
  exception when others then null;  -- a failed email must never stop a report from being saved
  end;
end $$;

create or replace function public.admin_test_notify() returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if coalesce(public.app_setting('notify_on'), '') <> '1' then return json_build_object('ok', false, 'error', 'Switch email alerts on and save first.'); end if;
  perform public.send_notify(jsonb_build_object('kind', 'test'));
  return json_build_object('ok', true);
end $$;

create or replace function public.trg_notify_report() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.send_notify(jsonb_build_object('kind', 'report', 'message', to_jsonb(new)->>'message', 'page', to_jsonb(new)->>'page',
    'contact', to_jsonb(new)->>'contact', 'details', left(to_jsonb(new)->>'details', 1500), 'at', to_jsonb(new)->>'at'));
  return new;
end $$;
do $$ begin
  if to_regclass('public.problem_reports') is not null then
    drop trigger if exists trg_notify_report on public.problem_reports;
    create trigger trg_notify_report after insert on public.problem_reports for each row execute function public.trg_notify_report();
  end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_set_notify(text,text,boolean)','admin_get_notify()','admin_test_notify()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  revoke all on function public.send_notify(jsonb) from public, anon, authenticated;
  revoke all on function public.trg_notify_report() from public, anon, authenticated;
end $$;
