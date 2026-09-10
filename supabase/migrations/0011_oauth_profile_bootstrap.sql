-- Google returns the display name under a different key than the email/password
-- flow does. The existing trigger only read 'full_name', so every account
-- created through Google would have landed with an empty profile name.
--
-- Order matters: 'full_name' is what our own signup form sets, so it wins;
-- 'name' is Google's key; 'given_name' is the fallback when a Google account
-- has no display name set. Empty string rather than null keeps the column's
-- existing contract with the account page, which does `full_name || "..."`.
--
-- Deliberately not captured: avatar_url. Rendering it would mean widening the
-- Content-Security-Policy's img-src to googleusercontent.com, and a profile
-- photo is not worth loosening the image policy on a site that currently
-- serves no third-party images at all.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'given_name'), ''),
      ''
    )
  )
  on conflict (id) do nothing;
  return new;
end
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
