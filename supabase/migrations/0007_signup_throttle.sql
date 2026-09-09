-- 1. Least privilege on the pure date helpers.
-- These are only ever called from inside SECURITY DEFINER functions (which run
-- as the owner, so the caller's EXECUTE bit is irrelevant) and from the cron
-- job. Nothing in the client calls them, and no policy, column default or check
-- constraint evaluates them in the caller's context — so exposing them as
-- /rest/v1/rpc endpoints is API surface with no purpose.
revoke execute on function public.ist_today() from public, anon, authenticated;
revoke execute on function public.cadence_hits(public.cadence, int[], date) from public, anon, authenticated;
revoke execute on function public.next_eligible_date(public.cadence, int[]) from public, anon, authenticated;

-- 2. Throttle the signup edge function.
-- signup is necessarily reachable by anonymous visitors (it is gated only by
-- the public anon key), and it creates confirmed users through the admin API.
-- Going through admin.createUser means Supabase Auth's own signup rate limits
-- never apply, so without this the endpoint will mint accounts as fast as it is
-- called. Attempts are keyed on a SHA-256 of the client IP so the table never
-- stores a raw address.
create table if not exists public.signup_attempts (
  ip_hash      text        not null,
  attempted_at timestamptz not null default now()
);

create index if not exists signup_attempts_lookup on public.signup_attempts (ip_hash, attempted_at desc);
create index if not exists signup_attempts_sweep  on public.signup_attempts (attempted_at);

-- RLS on with zero policies: unreachable for anon and authenticated even if a
-- future default grant hands the table back to them. service_role bypasses RLS,
-- which is how the edge function reaches it.
alter table public.signup_attempts enable row level security;
revoke all on public.signup_attempts from anon, authenticated;

-- Returns true when the attempt is allowed, false when the caller is over
-- budget. Sweeps rows older than the day window on the way through so the table
-- stays bounded without a separate cron job.
create or replace function public.note_signup_attempt(p_ip_hash text)
returns boolean
language plpgsql security definer set search_path = public as
$$
declare
  max_per_hour constant int := 5;
  max_per_day  constant int := 20;
  recent_hour  int;
  recent_day   int;
begin
  -- Caller must pass a sha-256 hex digest; refuse anything else rather than
  -- letting a malformed key share one bucket with everyone.
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  delete from public.signup_attempts where attempted_at < now() - interval '24 hours';

  select count(*) filter (where attempted_at > now() - interval '1 hour'), count(*)
    into recent_hour, recent_day
  from public.signup_attempts
  where ip_hash = p_ip_hash;

  if recent_hour >= max_per_hour or recent_day >= max_per_day then
    return false;
  end if;

  insert into public.signup_attempts (ip_hash) values (p_ip_hash);
  return true;
end
$$;

-- Only the edge function's service_role may call this.
revoke execute on function public.note_signup_attempt(text) from public, anon, authenticated;
