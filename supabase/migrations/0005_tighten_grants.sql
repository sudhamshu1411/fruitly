-- Fruitly backend · 0005 — remove an unused default grant
-- `exclusions` has SELECT/INSERT/DELETE policies but no UPDATE policy, so RLS
-- already denies updates. Drop the leftover grant so the privilege surface
-- matches the policy surface exactly.
revoke update on public.exclusions from anon, authenticated;
