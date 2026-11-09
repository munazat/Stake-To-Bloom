# Migrations

Numbered SQL migrations, applied in order by the Supabase CLI:

```
supabase/migrations/
  20261109000000_schema.sql      # tables + enums
  20261109000100_rls.sql         # Row Level Security policies
  20261109000200_functions.sql   # transition_pact, ai_usage increment, triggers
  20261109000300_storage.sql     # private `proofs` bucket + policies
```

Conventions:

- **Money is integer cents** (`bigint`), never a float/numeric-with-decimals.
- **RLS is enabled on every table.** Clients may `SELECT` only their own rows and
  may never `INSERT`/`UPDATE`/`DELETE` money, pact, proof, or settlement tables —
  only Edge Functions (service role) write those.
- Illegal pact state transitions and post-funding edits to `stake_cents`,
  `rule_spec`, `rule_hash`, or `currency` are rejected by DB triggers, not just app code.

These files are implemented and validated against Postgres 16.

Local workflow:

```bash
supabase start        # boot the local stack (Docker)
supabase db reset     # apply migrations/ in order, then seed.sql
supabase test db      # run the pgTAP tests in supabase/tests/
```

`supabase/tests/rls_and_invariants.sql` is the acceptance suite for these
migrations: RLS cross-user isolation, the `transition_pact` compare-and-set
(race) guarantee, the freeze-after-funding and append-only-ledger triggers,
the atomic AI-usage counters, and the private `proofs` bucket.
