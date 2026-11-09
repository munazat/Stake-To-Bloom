-- 20261109000000_schema.sql — enums + tables (blueprint §5).
--
-- Money is integer cents (bigint) everywhere; never float/numeric-with-decimals.
-- Every table gets Row Level Security in 20261109000100_rls.sql. Only Edge
-- Functions (service_role, which bypasses RLS) write; clients read their own rows.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.pact_status as enum (
  'DRAFT',
  'AWAITING_STAKE',
  'ACTIVE',
  'SETTLING',
  'SETTLED_PASS',
  'SETTLED_FAIL',
  'EXPIRED',
  'CANCELLED_REFUNDED',
  'NEEDS_REVIEW'
);

create type public.goal_type as enum ('steps', 'water', 'meal', 'workout', 'custom');

create type public.day_status as enum ('PENDING', 'PASSED', 'MISSED', 'UNCLEAR');

-- Mirrors packages/core VerdictSchema (PASS | FAIL | UNCLEAR | REJECTED).
create type public.verdict as enum ('PASS', 'FAIL', 'UNCLEAR', 'REJECTED');

create type public.ledger_kind as enum (
  'STAKE_IN',
  'SIM_STAKE',
  'PAYOUT_OUT',
  'REFUND_OUT',
  'CHARITY_OUT'
);

create type public.paypal_event_source as enum ('API', 'WEBHOOK');

create type public.pool_status as enum ('DRAFT', 'ACTIVE', 'SETTLING', 'SETTLED', 'CANCELLED');

create type public.settlement_status as enum (
  'PLANNED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'NEEDS_REVIEW'
);

-- ---------------------------------------------------------------------------
-- profiles — one row per user, auto-created on first sign-in (trigger below).
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  tz          text not null default 'UTC',
  is_guest    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- pools — a group of pacts that share forfeits.
-- ---------------------------------------------------------------------------
create table public.pools (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  is_demo    boolean not null default false,
  join_code  text unique,
  status     public.pool_status not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- pacts — the commitment. stake is 500..5000 cents ($5..$50), USD only.
-- ---------------------------------------------------------------------------
create table public.pacts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (user_id) on delete cascade,
  pool_id            uuid references public.pools (id) on delete set null,
  goal_type          public.goal_type not null,
  title              text not null check (char_length(title) between 1 and 80),
  rule_spec          jsonb not null,
  rule_hash          text not null check (rule_hash ~ '^[0-9a-f]{64}$'),
  stake_cents        bigint not null check (stake_cents between 500 and 5000),
  currency           text not null default 'USD' check (currency = 'USD'),
  required_passes    integer not null check (required_passes between 4 and 7),
  days               integer not null default 7 check (days = 7),
  status             public.pact_status not null default 'DRAFT',
  tz                 text not null default 'UTC',
  starts_at          timestamptz,
  ends_at            timestamptz,
  funded_at          timestamptz,
  is_demo            boolean not null default false,
  virtual_day_offset integer not null default 0,
  vitality           double precision not null default 0 check (vitality between 0 and 1),
  paypal_order_id    text unique,
  paypal_capture_id  text unique,
  payer_email        text,
  payer_id           text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index pacts_user_id_idx on public.pacts (user_id);
create index pacts_pool_id_idx on public.pacts (pool_id);
create index pacts_status_idx on public.pacts (status);

-- ---------------------------------------------------------------------------
-- proofs — every upload and what the gate decided. Unique (pact_id, sha256)
-- blocks reusing the same image for a second day.
-- ---------------------------------------------------------------------------
create table public.proofs (
  id                uuid primary key default gen_random_uuid(),
  pact_id           uuid not null references public.pacts (id) on delete cascade,
  day_index         integer not null check (day_index between 0 and 6),
  storage_path      text not null,
  sha256            text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  ai_model          text,
  ai_raw            jsonb,
  observations      jsonb,
  injection_flag    boolean not null default false,
  injection_reasons text[],
  gate_result       jsonb,
  final_status      public.verdict,
  attempt_no        integer not null default 1 check (attempt_no between 1 and 3),
  created_at        timestamptz not null default now(),
  unique (pact_id, sha256)
);
create index proofs_pact_day_idx on public.proofs (pact_id, day_index);

-- ---------------------------------------------------------------------------
-- pact_days — one row per day (0..6), created when the pact activates.
-- ---------------------------------------------------------------------------
create table public.pact_days (
  pact_id         uuid not null references public.pacts (id) on delete cascade,
  day_index       integer not null check (day_index between 0 and 6),
  date_local      date not null,
  status          public.day_status not null default 'PENDING',
  passed_proof_id uuid references public.proofs (id) on delete set null,
  primary key (pact_id, day_index)
);

-- ---------------------------------------------------------------------------
-- ledger_entries — append-only money log. Invariants in §6 are checked on it.
-- A trigger (functions migration) rejects UPDATE/DELETE outright.
-- ---------------------------------------------------------------------------
create table public.ledger_entries (
  id           bigint generated always as identity primary key,
  pact_id      uuid not null references public.pacts (id) on delete cascade,
  kind         public.ledger_kind not null,
  amount_cents bigint not null check (amount_cents > 0),
  ref          text not null,
  created_at   timestamptz not null default now(),
  unique (kind, ref)
);
create index ledger_entries_pact_idx on public.ledger_entries (pact_id);

-- ---------------------------------------------------------------------------
-- paypal_events — feeds the live audit page. Unique event_id makes webhook
-- replays impossible (API-sourced rows may leave event_id null).
-- ---------------------------------------------------------------------------
create table public.paypal_events (
  id             bigint generated always as identity primary key,
  source         public.paypal_event_source not null,
  event_id       text unique,
  event_type     text not null,
  resource_id    text,
  pact_id        uuid references public.pacts (id) on delete set null,
  status         text,
  amount_cents   bigint,
  public_payload jsonb,
  verified       boolean not null default false,
  created_at     timestamptz not null default now()
);
create index paypal_events_pact_idx on public.paypal_events (pact_id);

-- ---------------------------------------------------------------------------
-- settlements — the computed plan, stored before any money moves. Exactly one
-- per pact OR per pool, ever (invariant I5): the partial unique indexes plus the
-- ACTIVE->SETTLING transition guarantee it. `plan` is immutable once written.
-- ---------------------------------------------------------------------------
create table public.settlements (
  id              uuid primary key default gen_random_uuid(),
  pool_id         uuid references public.pools (id) on delete cascade,
  pact_id         uuid references public.pacts (id) on delete cascade,
  plan            jsonb not null,
  plan_hash       text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  status          public.settlement_status not null default 'PLANNED',
  sender_batch_id text unique,
  payout_batch_id text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((pool_id is null) <> (pact_id is null))
);
create unique index settlements_one_per_pool on public.settlements (pool_id) where pool_id is not null;
create unique index settlements_one_per_pact on public.settlements (pact_id) where pact_id is not null;

-- ---------------------------------------------------------------------------
-- ai_usage / ai_usage_global — daily AI caps, bumped atomically by a function.
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  day     date not null,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  count   integer not null default 0 check (count >= 0),
  primary key (day, user_id)
);

create table public.ai_usage_global (
  day   date primary key,
  count integer not null default 0 check (count >= 0)
);

-- ---------------------------------------------------------------------------
-- verdict_cache — demo sample proofs only, used when every model is rate-limited.
-- Always labelled "cached from an earlier live run" in the UI.
-- ---------------------------------------------------------------------------
create table public.verdict_cache (
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  model       text not null,
  verdict     public.verdict not null,
  observation jsonb,
  created_at  timestamptz not null default now(),
  primary key (sha256, model)
);

-- ---------------------------------------------------------------------------
-- app_config — kill switches (invariant I10). Server-side only; no client read.
-- Defaults are the safe state: money movement OFF until creds are configured.
-- ---------------------------------------------------------------------------
create table public.app_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_config (key, value) values
  ('payments_enabled', 'false'::jsonb),
  ('settlement_enabled', 'false'::jsonb),
  ('ai_enabled', 'true'::jsonb)
on conflict (key) do nothing;
