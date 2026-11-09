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

These files are authored in **Phase 3**.
