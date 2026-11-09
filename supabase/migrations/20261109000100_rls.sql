-- 20261109000100_rls.sql — Row Level Security (blueprint §5, §9).
--
-- Model: RLS is enabled on every table. Clients (anon / authenticated) may
-- SELECT only their own rows and may NEVER INSERT/UPDATE/DELETE any pact, proof,
-- money, or settlement table — only Edge Functions (service_role) write, and
-- service_role bypasses RLS. We also explicitly REVOKE write privileges from the
-- client roles so that even an RLS mistake cannot let a browser move data.

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on every table.
-- ---------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.pools           enable row level security;
alter table public.pacts           enable row level security;
alter table public.proofs          enable row level security;
alter table public.pact_days       enable row level security;
alter table public.ledger_entries  enable row level security;
alter table public.paypal_events   enable row level security;
alter table public.settlements     enable row level security;
alter table public.ai_usage        enable row level security;
alter table public.ai_usage_global enable row level security;
alter table public.verdict_cache   enable row level security;
alter table public.app_config      enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Strip every privilege from client roles, then grant back only reads.
--    (service_role keeps full access and is intentionally not touched here.)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from public, anon, authenticated;

grant select on public.profiles       to authenticated;
grant select, update on public.profiles to authenticated; -- self profile (display_name, tz)
grant select on public.pools          to authenticated;
grant select on public.pacts          to authenticated;
grant select on public.proofs         to authenticated;
grant select on public.pact_days      to authenticated;
grant select on public.ledger_entries to authenticated;
grant select on public.paypal_events  to authenticated;
grant select on public.settlements    to authenticated;
grant select on public.ai_usage       to authenticated;
grant select on public.verdict_cache  to authenticated;
-- app_config and ai_usage_global: no client grant at all (server-side only).

-- ---------------------------------------------------------------------------
-- 3. SELECT policies — a user sees only rows that belong to them.
-- ---------------------------------------------------------------------------
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (user_id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A pool is visible if it is a demo pool or the user has a pact inside it.
create policy pools_select on public.pools
  for select to authenticated
  using (
    is_demo
    or exists (select 1 from public.pacts p where p.pool_id = pools.id and p.user_id = auth.uid())
  );

create policy pacts_select_self on public.pacts
  for select to authenticated
  using (user_id = auth.uid());

-- Child tables are owned through their pact.
create policy proofs_select_self on public.proofs
  for select to authenticated
  using (exists (select 1 from public.pacts p where p.id = proofs.pact_id and p.user_id = auth.uid()));

create policy pact_days_select_self on public.pact_days
  for select to authenticated
  using (exists (select 1 from public.pacts p where p.id = pact_days.pact_id and p.user_id = auth.uid()));

create policy ledger_select_self on public.ledger_entries
  for select to authenticated
  using (exists (select 1 from public.pacts p where p.id = ledger_entries.pact_id and p.user_id = auth.uid()));

create policy paypal_events_select_self on public.paypal_events
  for select to authenticated
  using (exists (select 1 from public.pacts p where p.id = paypal_events.pact_id and p.user_id = auth.uid()));

create policy settlements_select_self on public.settlements
  for select to authenticated
  using (
    (pact_id is not null and exists (select 1 from public.pacts p where p.id = settlements.pact_id and p.user_id = auth.uid()))
    or (pool_id is not null and exists (select 1 from public.pacts p where p.pool_id = settlements.pool_id and p.user_id = auth.uid()))
  );

create policy ai_usage_select_self on public.ai_usage
  for select to authenticated
  using (user_id = auth.uid());

-- verdict_cache holds only demo sample verdicts (non-sensitive), readable by any
-- signed-in user so the demo works when every model is rate-limited.
create policy verdict_cache_select on public.verdict_cache
  for select to authenticated
  using (true);
