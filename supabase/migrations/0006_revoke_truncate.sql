-- TRUNCATE is not governed by row-level security at all — a role holding it
-- can empty a table outright regardless of any policy. Supabase's default
-- grants include it, and earlier migrations only ever revoked
-- insert/update/delete, so anon and authenticated were still left holding
-- TRUNCATE on every public table. Not reachable through PostgREST today (it
-- exposes no truncate endpoint), but it is excess privilege with no policy
-- backing it, so close it as defense-in-depth.
revoke truncate on
  public.profiles, public.addresses, public.fruits, public.boxes,
  public.subscriptions, public.subscription_items, public.exclusions,
  public.skips, public.orders, public.order_items, public.ratings
from anon, authenticated;
