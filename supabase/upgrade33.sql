-- upgrade33.sql  (run after upgrade32.sql; safe to run twice)
-- Feature switches: the admin can turn whole features on or off for every lecturer.

create or replace function public.feature_on(k text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select value from public.app_settings where key = 'feat_' || k), '1') <> '0'
$$;
grant execute on function public.feature_on(text) to anon, authenticated;

create or replace function public.admin_set_feature(p_key text, p_on boolean) returns json
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_key not in ('new_classes','manual_add','chat','rolls','exports','lookup','announce') then return json_build_object('ok', false, 'error', 'Unknown feature.'); end if;
  insert into public.app_settings(key, value) values ('feat_' || p_key, case when p_on then '1' else '0' end)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.audit('feature_switch', p_key, case when p_on then 'on' else 'off' end);
  return public.get_public_settings();
end $$;
revoke all on function public.admin_set_feature(text,boolean) from public, anon;
grant execute on function public.admin_set_feature(text,boolean) to authenticated;

create or replace function public.get_public_settings() returns json
language sql stable security definer set search_path to 'public' as $$
  select json_build_object('paused', coalesce(public.app_setting('pause_checkins'), '') = '1',
                           'message', coalesce(public.app_setting('pause_message'), ''),
                           'popups', coalesce(public.app_setting('popups_off'), '') <> '1',
                           'year', coalesce(public.app_setting('term_year'), ''),
                           'semester', coalesce(public.app_setting('term_sem'), ''),
                           'features', json_build_object(
                             'new_classes', public.feature_on('new_classes'), 'manual_add', public.feature_on('manual_add'),
                             'chat', public.feature_on('chat'), 'rolls', public.feature_on('rolls'),
                             'exports', public.feature_on('exports'), 'lookup', public.feature_on('lookup'), 'announce', public.feature_on('announce')));
$$;
grant execute on function public.get_public_settings() to anon, authenticated;

-- The database refuses the action even if someone skips the page. Admin and system actions are not blocked.
create or replace function public.feature_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare k text := tg_argv[0];
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if k = 'manual_add' and coalesce(to_jsonb(new)->>'manual', 'false') <> 'true' then return new; end if;
  if k = 'chat' and coalesce(to_jsonb(new)->>'sender', '') <> 'staff' then return new; end if;
  if not public.feature_on(k) then raise exception 'The admin has switched this feature off.'; end if;
  return new;
end $$;
drop trigger if exists trg_feat_classes on public.sessions;
create trigger trg_feat_classes before insert on public.sessions for each row execute function public.feature_guard('new_classes');
drop trigger if exists trg_feat_manual on public.attendance;
create trigger trg_feat_manual before insert on public.attendance for each row execute function public.feature_guard('manual_add');
drop trigger if exists trg_feat_chat on public.staff_messages;
create trigger trg_feat_chat before insert on public.staff_messages for each row execute function public.feature_guard('chat');
drop trigger if exists trg_feat_rolls on public.rolls;
create trigger trg_feat_rolls before insert on public.rolls for each row execute function public.feature_guard('rolls');
