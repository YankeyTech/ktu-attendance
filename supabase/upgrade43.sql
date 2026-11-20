-- upgrade43.sql  (run after upgrade42.sql; safe to run twice)
-- Lets the admin open and run ANY class on the lecturer screen (live code, QR, extend, close, add students by hand).
drop policy if exists "admin manages all sessions" on public.sessions;
create policy "admin manages all sessions" on public.sessions for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin manages all attendance" on public.attendance;
create policy "admin manages all attendance" on public.attendance for all to authenticated using (public.is_admin()) with check (public.is_admin());
