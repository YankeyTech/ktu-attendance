-- upgrade27.sql  (run after upgrade26.sql; safe to run twice)
-- Admin inbox: decide phone alerts and outside-area check-ins on behalf of a lecturer, and control the popups on lecturer pages.

alter table public.attendance add column if not exists reviewed boolean default false;
alter table public.profiles   add column if not exists alerts_by_admin boolean not null default false;

-- Public settings now also say whether popups are shown on lecturer pages.
create or replace function public.get_public_settings() returns json
language sql stable security definer set search_path to 'public' as $$
  select json_build_object('paused', coalesce(public.app_setting('pause_checkins'), '') = '1',
                           'message', coalesce(public.app_setting('pause_message'), ''),
                           'popups', coalesce(public.app_setting('popups_off'), '') <> '1');
$$;
grant execute on function public.get_public_settings() to anon, authenticated;

create or replace function public.admin_set_popups(p_on boolean) returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  insert into public.app_settings(key, value) values ('popups_off', case when p_on then '0' else '1' end)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit(case when p_on then 'popups_on' else 'popups_off' end, 'all lecturers', null);
  return public.get_public_settings();
end $$;

-- The admin takes over (or hands back) the alerts of one lecturer: their popups stop and the admin decides.
create or replace function public.admin_set_alerts_by_admin(p_id uuid, p_on boolean) returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  update public.profiles set alerts_by_admin = p_on where id = p_id and role <> 'admin';
  perform public.audit(case when p_on then 'alerts_taken_over' else 'alerts_handed_back' end, (select email from public.profiles where id = p_id), null);
  return json_build_object('ok', true);
end $$;

-- Decide every waiting phone alert of one lecturer at once.
create or replace function public.admin_decide_all(p_owner uuid, p_allow boolean) returns int
language plpgsql security definer set search_path to 'public' as $$
declare b record; n int := 0; r json;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  for b in select ba.id from public.blocked_attempts ba join public.sessions s on s.id = ba.session_id where s.owner = p_owner and ba.status = 'pending' loop
    r := public.resolve_blocked(b.id, p_allow);
    if (r->>'ok')::boolean then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Undo a decision: the alert goes back to "waiting". If it had been allowed, the check-in it created is removed (kept in the Trash).
create or replace function public.admin_reopen_blocked(p_id uuid) returns json
language plpgsql security definer set search_path to 'public' as $$
declare b public.blocked_attempts;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into b from public.blocked_attempts where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'Alert not found.'); end if;
  if b.status = 'allowed' then
    delete from public.attendance where session_id = b.session_id and index_number = b.index_number and note = 'Allowed by lecturer after shared-phone alert';
  end if;
  update public.blocked_attempts set status = 'pending', decided_at = null where id = p_id;
  perform public.audit('alert_reopened', b.index_number, null);
  return json_build_object('ok', true);
end $$;

-- Review an outside-area check-in for a lecturer: accept, keep outside, or remove.
create or replace function public.admin_review_checkin(p_id uuid, p_action text) returns json
language plpgsql security definer set search_path to 'public' as $$
declare a public.attendance;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into a from public.attendance where id = p_id;
  if not found then return json_build_object('ok', false, 'error', 'Check-in not found.'); end if;
  if p_action = 'accept' then update public.attendance set in_range = true, manual = true, reviewed = true where id = p_id;
  elsif p_action = 'keep' then update public.attendance set reviewed = true where id = p_id;
  elsif p_action = 'remove' then delete from public.attendance where id = p_id;
  else return json_build_object('ok', false, 'error', 'Unknown action.'); end if;
  perform public.audit('review_by_admin', a.index_number, p_action);
  return json_build_object('ok', true);
end $$;

do $$ declare f text; begin
  foreach f in array array['admin_set_popups(boolean)','admin_set_alerts_by_admin(uuid,boolean)','admin_decide_all(uuid,boolean)','admin_reopen_blocked(uuid)','admin_review_checkin(uuid,text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
