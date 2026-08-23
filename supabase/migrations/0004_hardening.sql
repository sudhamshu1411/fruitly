-- Fruitly backend · 0004 — advisor hardening
-- Pin search_path on the remaining helpers and keep is_staff() away from anon.
-- (The customer RPCs are intentionally executable by `authenticated` — they are
-- the API, and each validates auth.uid() + ownership internally.)

alter function public.ist_today() set search_path = public;
alter function public.cadence_hits(public.cadence, int[], date) set search_path = public;
alter function public.next_eligible_date(public.cadence, int[]) set search_path = public;

revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;
