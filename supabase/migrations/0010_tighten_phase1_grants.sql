-- Corrective migration for 0009.
--
-- 0009 created fruit_ops and fulfillment_issues with `revoke all ... from anon`
-- but not from authenticated, then granted back only what was intended. That
-- is not the same thing: Supabase's default privileges on the public schema
-- hand new tables ALL to both API roles, so everything I did not name stayed
-- granted — DELETE and TRUNCATE on both tables, plus INSERT on
-- fulfillment_issues, which was meant to be written only by the order
-- generator. inventory_movements escaped this because it did revoke from both
-- roles first. RLS still refused non-staff writes throughout, so nothing was
-- exposed, but this is excess privilege with no policy reason to exist — the
-- same shape as the TRUNCATE gap found in the earlier audit.
--
-- Both tables become read-only to the API roles. Every write goes through a
-- SECURITY DEFINER RPC that checks is_staff() itself, which is also how the
-- rest of this codebase works: the client sends intent, the server decides.

revoke all on public.fruit_ops         from anon, authenticated;
revoke all on public.fulfillment_issues from anon, authenticated;

grant select on public.fruit_ops          to authenticated;  -- RLS narrows to staff
grant select on public.fulfillment_issues to authenticated;  -- RLS narrows to staff

-- categories keeps staff CRUD through RLS (simple reference data, no computed
-- or financial fields), but must not keep the default TRUNCATE.
revoke truncate on public.categories from anon, authenticated;

-- Sweep the two inert-but-pointless defaults off every table in the schema.
-- Neither role can create objects in public (verified: no CREATE on the
-- schema), so TRIGGER and REFERENCES buy an attacker nothing today — but they
-- are grants nobody asked for, and "nobody asked for it" is how the TRUNCATE
-- hole survived three audits.
do $$
declare t record;
begin
  for t in
    select format('%I.%I', schemaname, tablename) as rel
    from pg_tables where schemaname = 'public'
  loop
    execute format('revoke trigger, references, truncate on %s from anon, authenticated', t.rel);
  end loop;
end $$;

-- Writing fruit costs and reorder thresholds. Stamps updated_at server-side
-- rather than trusting a client-supplied timestamp, and validates the range
-- the CHECK constraint would otherwise reject with a database error message.
create or replace function public.set_fruit_ops(
  p_fruit_id text,
  p_cost_price_paise int,
  p_reorder_threshold int
) returns void
language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if not exists (select 1 from public.fruits where id = p_fruit_id) then
    raise exception 'unknown fruit';
  end if;
  if p_cost_price_paise is not null and p_cost_price_paise < 0 then
    raise exception 'cost cannot be negative';
  end if;
  if p_reorder_threshold is null or p_reorder_threshold < 0 or p_reorder_threshold > 100000 then
    raise exception 'reorder threshold must be between 0 and 100000';
  end if;

  insert into public.fruit_ops (fruit_id, cost_price_paise, reorder_threshold, updated_at)
  values (p_fruit_id, p_cost_price_paise, p_reorder_threshold, now())
  on conflict (fruit_id) do update
    set cost_price_paise = excluded.cost_price_paise,
        reorder_threshold = excluded.reorder_threshold,
        updated_at = now();
end
$$;

revoke execute on function public.set_fruit_ops(text, int, int) from public, anon;

-- category_id is a catalogue attribute staff must be able to set, and the
-- column-level grant on fruits is an allow-list — a column not named here
-- cannot be written even by staff. (That is also why stock_qty is absent:
-- it may only move through adjust_stock(), so the ledger can never drift.)
grant update (category_id) on public.fruits to authenticated;
grant update (category_id) on public.boxes  to authenticated;
