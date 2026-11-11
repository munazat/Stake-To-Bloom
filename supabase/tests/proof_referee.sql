-- Acceptance tests for the proof referee's database surface.
-- Run with:  supabase test db
--
-- Proves:
--   * user A cannot write proofs at all, and cannot upload into user B's folder
--     (so "submit a proof for someone else's pact" is impossible from a browser;
--     the Edge Function enforces pact ownership on top of this).
--   * bump_ai_usage_pair — both counters move atomically; clients cannot call it.
--   * record_day_pass — PASS once, vitality once, never resurrects a MISSED day,
--     refuses a pact that is not ACTIVE; clients cannot call it.

begin;
select plan(17);

insert into auth.users (id, created_at, updated_at, is_anonymous) values
  ('a1111111-1111-1111-1111-111111111111', now(), now(), true),
  ('b2222222-2222-2222-2222-222222222222', now(), now(), true);

insert into public.pacts
  (id, user_id, goal_type, title, rule_spec, rule_hash, stake_cents, currency,
   required_passes, days, status, tz, vitality, starts_at, ends_at, funded_at)
values
  ('cccccccc-0000-0000-0000-00000000000b',
   'b2222222-2222-2222-2222-222222222222',
   'steps', 'B''s pact', '{}'::jsonb, repeat('c', 64),
   2000, 'USD', 5, 7, 'AWAITING_STAKE', 'UTC', 0, now(), now() + interval '7 days', null);

-- Fund it the way paypal-capture-order will: legal transition, then day rows.
update public.pacts set status = 'ACTIVE', vitality = 0.15, funded_at = now()
 where id = 'cccccccc-0000-0000-0000-00000000000b';
insert into public.pact_days (pact_id, day_index, date_local, status)
select 'cccccccc-0000-0000-0000-00000000000b', d, current_date + d, 'PENDING'
  from generate_series(0, 6) as d;
update public.pact_days set status = 'MISSED'
 where pact_id = 'cccccccc-0000-0000-0000-00000000000b' and day_index = 6;

insert into public.proofs (id, pact_id, day_index, storage_path, sha256, final_status, attempt_no)
values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-00000000000b', 0,
        'b2222222-2222-2222-2222-222222222222/cccccccc-0000-0000-0000-00000000000b/0-x.jpg',
        repeat('d', 64), 'PASS', 1);

-- ---------------------------------------------------------------------------
-- Client roles: user A against user B's pact.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select throws_ok(
  $$ insert into public.proofs (pact_id, day_index, storage_path, sha256, final_status)
     values ('cccccccc-0000-0000-0000-00000000000b', 1, 'x', repeat('e', 64), 'PASS') $$,
  '42501', null, 'user A cannot INSERT a proof for user B''s pact'
);
select throws_ok(
  $$ update public.pact_days set status = 'PASSED'
      where pact_id = 'cccccccc-0000-0000-0000-00000000000b' $$,
  '42501', null, 'user A cannot mark user B''s day PASSED'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('proofs', 'b2222222-2222-2222-2222-222222222222/cccccccc-0000-0000-0000-00000000000b/1-evil.jpg',
             'a1111111-1111-1111-1111-111111111111') $$,
  '42501', null, 'user A cannot upload into user B''s proof folder'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('proofs', 'a1111111-1111-1111-1111-111111111111/any/0-mine.jpg',
             'a1111111-1111-1111-1111-111111111111') $$,
  'user A can upload into their own folder'
);
select is((select count(*) from public.proofs), 0::bigint, 'user A cannot read user B''s proofs');
select throws_ok(
  $$ select public.bump_ai_usage_pair('a1111111-1111-1111-1111-111111111111') $$,
  '42501', null, 'clients cannot bump AI usage'
);
select throws_ok(
  $$ select public.record_day_pass('cccccccc-0000-0000-0000-00000000000b', 0,
                                   'dddddddd-0000-0000-0000-000000000001', 0.18) $$,
  '42501', null, 'clients cannot record a day pass'
);

reset role;

-- ---------------------------------------------------------------------------
-- Service role behaviour.
-- ---------------------------------------------------------------------------
set local role service_role;

select is(
  (select row(user_count, global_count)::text
     from public.bump_ai_usage_pair('a1111111-1111-1111-1111-111111111111', date '2026-01-01')),
  '(1,1)', 'first bump returns user=1, global=1'
);
select is(
  (select row(user_count, global_count)::text
     from public.bump_ai_usage_pair('b2222222-2222-2222-2222-222222222222', date '2026-01-01')),
  '(1,2)', 'a second user sees their own count and the shared global count'
);

select is(
  public.record_day_pass('cccccccc-0000-0000-0000-00000000000b', 0, 'dddddddd-0000-0000-0000-000000000001', 0.18),
  0.33::double precision, 'a pass adds the delta once, rounded to 4 dp'
);
select is(
  (select status::text from public.pact_days
    where pact_id = 'cccccccc-0000-0000-0000-00000000000b' and day_index = 0),
  'PASSED', 'the day is PASSED and linked to the proof'
);
select is(
  public.record_day_pass('cccccccc-0000-0000-0000-00000000000b', 0, 'dddddddd-0000-0000-0000-000000000001', 0.18),
  null::double precision, 'a second pass for the same day changes nothing'
);
select is(
  (select vitality from public.pacts where id = 'cccccccc-0000-0000-0000-00000000000b'),
  0.33::double precision, 'vitality was raised exactly once'
);
select is(
  public.record_day_pass('cccccccc-0000-0000-0000-00000000000b', 6, 'dddddddd-0000-0000-0000-000000000001', 0.18),
  null::double precision, 'a MISSED day can never become a pass'
);
select throws_ok(
  $$ select public.record_day_pass('cccccccc-0000-0000-0000-00000000000b', 1,
                                   'dddddddd-0000-0000-0000-000000000001', 5) $$,
  '22023', null, 'an out-of-range delta is refused'
);

reset role;
update public.pacts set status = 'SETTLING' where id = 'cccccccc-0000-0000-0000-00000000000b';
set local role service_role;
select throws_ok(
  $$ select public.record_day_pass('cccccccc-0000-0000-0000-00000000000b', 1,
                                   'dddddddd-0000-0000-0000-000000000001', 0.18) $$,
  '40001', null, 'a pact that is no longer ACTIVE cannot gain a pass'
);
select is(
  (select status::text from public.pact_days
    where pact_id = 'cccccccc-0000-0000-0000-00000000000b' and day_index = 1),
  'PENDING', '...and the refused call left the day untouched'
);

select * from finish();
rollback;
