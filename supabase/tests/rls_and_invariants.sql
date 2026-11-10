-- Acceptance tests for supabase/migrations (blueprint §1.7, §14.1).
-- Run with:  supabase test db
--
-- Proves:
--   * RLS cross-user — user A cannot read or write user B's rows.
--   * transition_pact — compare-and-set: a stale/duplicate move fails (exactly one wins).
--   * triggers — cannot edit stake/rule_hash after funding; illegal status edges rejected;
--     ledger_entries is append-only.
--   * bump_ai_usage — atomic per-user + global daily counters.
--   * storage — the proofs bucket is private.

begin;
select no_plan();

-- Three throwaway users; handle_new_user auto-creates their profiles. The third
-- is anonymous, which is how every guest arrives.
insert into auth.users (id, created_at, updated_at, is_anonymous) values
  ('11111111-1111-1111-1111-111111111111', now(), now(), false),
  ('22222222-2222-2222-2222-222222222222', now(), now(), false),
  ('33333333-3333-3333-3333-333333333333', now(), now(), true);

select has_table('public', 'pacts', 'pacts table exists');

select is(
  (select count(*) from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  1::bigint,
  'profile auto-created for user A on sign-in'
);

-- A guest has no email, so it can never be a PayPal payout recipient. Settlement
-- depends on this flag being right.
select is(
  (select is_guest from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  false,
  'a normal sign-in is not flagged as a guest'
);
select is(
  (select is_guest from public.profiles where user_id = '33333333-3333-3333-3333-333333333333'),
  true,
  'an anonymous sign-in is flagged as a guest'
);

-- Privileged setup (superuser bypasses RLS): a pact owned by user A, awaiting stake.
insert into public.pacts
  (id, user_id, goal_type, title, rule_spec, rule_hash, stake_cents, currency,
   required_passes, days, status, tz)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   'steps', 'Walk 10,000 steps', '{}'::jsonb, repeat('a', 64),
   2000, 'USD', 5, 7, 'AWAITING_STAKE', 'UTC');

insert into public.ledger_entries (pact_id, kind, amount_cents, ref)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'STAKE_IN', 2000, 'bloom-capture-test');

-- ---------------------------------------------------------------------------
-- RLS: user A reads their own row; user B reads nothing and cannot write.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
select is((select count(*) from public.pacts), 1::bigint, 'user A can SELECT their own pact');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
select is((select count(*) from public.pacts), 0::bigint, 'user B cannot SELECT user A''s pact');

select throws_ok(
  $$ insert into public.pacts
       (id, user_id, goal_type, title, rule_spec, rule_hash, stake_cents, currency,
        required_passes, days, status, tz)
     values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
             '22222222-2222-2222-2222-222222222222',
             'steps', 'x', '{}'::jsonb, repeat('b', 64), 2000, 'USD', 5, 7, 'DRAFT', 'UTC') $$,
  '42501', null, 'user B cannot INSERT into pacts (no write grant)'
);
select throws_ok(
  $$ update public.pacts set title = 'hacked' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501', null, 'user B cannot UPDATE pacts'
);
select throws_ok(
  $$ delete from public.pacts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501', null, 'user B cannot DELETE pacts'
);

reset role;

-- ---------------------------------------------------------------------------
-- transition_pact: compare-and-set semantics (the double-click / race guarantee).
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.transition_pact('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'AWAITING_STAKE', 'ACTIVE') $$,
  'legal transition AWAITING_STAKE -> ACTIVE succeeds'
);
select throws_ok(
  $$ select public.transition_pact('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'AWAITING_STAKE', 'ACTIVE') $$,
  '40001', null, 'a stale/duplicate transition fails — exactly one wins'
);

select throws_ok(
  $$ update public.pacts set status = 'SETTLED_PASS' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '22023', null, 'illegal edge ACTIVE -> SETTLED_PASS rejected by the guard trigger'
);

-- ---------------------------------------------------------------------------
-- Freeze after funding (invariant I9).
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.pacts set stake_cents = 3000 where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '22023', null, 'cannot edit stake_cents after funding'
);
select throws_ok(
  $$ update public.pacts set rule_hash = repeat('c', 64) where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '22023', null, 'cannot edit rule_hash after funding'
);
select lives_ok(
  $$ update public.pacts set vitality = 0.5 where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'a non-frozen field (vitality) is still editable while ACTIVE'
);

-- ---------------------------------------------------------------------------
-- ledger_entries is append-only.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.ledger_entries set amount_cents = 1 where ref = 'bloom-capture-test' $$,
  '22023', null, 'ledger_entries cannot be updated'
);
select throws_ok(
  $$ delete from public.ledger_entries where ref = 'bloom-capture-test' $$,
  '22023', null, 'ledger_entries cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- bump_ai_usage: atomic counters.
-- ---------------------------------------------------------------------------
select is(public.bump_ai_usage('11111111-1111-1111-1111-111111111111', date '2026-11-09'), 1, 'first AI use returns 1');
select is(public.bump_ai_usage('11111111-1111-1111-1111-111111111111', date '2026-11-09'), 2, 'second AI use returns 2');
select is((select count from public.ai_usage_global where day = date '2026-11-09'), 2, 'global AI counter tracks the total');

-- ---------------------------------------------------------------------------
-- Realtime: the garden's tables must actually be published. A subscription to an
-- unpublished table connects and then delivers nothing, with no error to notice.
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pacts'),
  1::bigint,
  'pacts is published, so funding a pact plants the seed without a refresh'
);
select is(
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pact_days'),
  1::bigint,
  'pact_days is published, so a verified day grows the plant live'
);
select is(
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename in ('ledger_entries', 'settlements', 'paypal_events')),
  0::bigint,
  'money tables are not broadcast; the client reads them over REST'
);

-- ---------------------------------------------------------------------------
-- storage: private proofs bucket.
-- ---------------------------------------------------------------------------
select is((select public from storage.buckets where id = 'proofs'), false, 'proofs bucket is private');

select * from finish();
rollback;
