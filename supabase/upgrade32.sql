-- upgrade32.sql  (run after upgrade31.sql; safe to run twice)
-- Term report: attendance percentage per student for one course, with excused absences taken out.

create or replace function public.admin_term_report(p_course text, p_year text default '', p_sem text default '', p_programme text default '', p_level text default '')
returns table(index_number text, student_name text, programme text, level text, held int, attended int, excused int, pct numeric)
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return query
    with ses as (
      select s.id from public.sessions s
      where s.course = p_course and (coalesce(p_year, '') = '' or s.academic_year = p_year) and (coalesce(p_sem, '') = '' or s.semester = p_sem)
        and (coalesce(p_programme, '') = '' or s.combined or s.programme = p_programme) and (coalesce(p_level, '') = '' or s.combined or s.level = p_level)),
    h as (select count(*)::int n from ses),
    att as (
      select upper(a.index_number) idx, max(a.student_name) nm, max(a.programme) pr, max(a.level) lv, count(distinct a.session_id)::int n
      from public.attendance a join ses on ses.id = a.session_id group by 1),
    exc as (
      select upper(e.index_number) idx, count(distinct e.session_id)::int n
      from public.excuses e join ses on ses.id = e.session_id group by 1),
    rl as (
      select distinct on (upper(r.index_number)) upper(r.index_number) idx, r.student_name nm, r.programme pr, r.level lv
      from public.rolls r where r.course = p_course order by upper(r.index_number)),
    ids as (select att.idx from att union select rl.idx from rl),
    j as (
      select i.idx, coalesce(att.nm, rl.nm) nm, coalesce(att.pr, rl.pr) pr, coalesce(att.lv, rl.lv) lv, coalesce(att.n, 0) a, coalesce(exc.n, 0) x
      from ids i left join att on att.idx = i.idx left join exc on exc.idx = i.idx left join rl on rl.idx = i.idx)
    select j.idx, j.nm, j.pr, j.lv, h.n, j.a, j.x,
           case when h.n - j.x > 0 then round(100.0 * j.a / (h.n - j.x), 1) else null end
    from j cross join h
    where (coalesce(p_programme, '') = '' or j.pr is null or j.pr = p_programme) and (coalesce(p_level, '') = '' or j.lv is null or j.lv = p_level)
    order by 8 nulls last, j.idx;
end $$;
revoke all on function public.admin_term_report(text,text,text,text,text) from public, anon;
grant execute on function public.admin_term_report(text,text,text,text,text) to authenticated;
