-- 20261110000000_proof_referee.sql — database support for submit-proof.
--
--   * bump_ai_usage_pair() — the per-user AND global daily AI counters, bumped in
--     one statement pair and both returned, so the function can enforce both
--     caps. (bump_ai_usage() returns only the user's count; reading the global
--     row afterwards would race other users' requests.)
--   * record_day_pass() — marks a day PASSED and raises vitality in ONE
--     transaction, exactly once. Two concurrent PASS proofs for the same day
--     cannot water the plant twice: the second finds the day already PASSED and
--     changes nothing. A MISSED day can never be turned into a pass.
--
-- Both are SECURITY DEFINER with EXECUTE revoked from client roles: only Edge
-- Functions (service_role) may count AI usage or move vitality.

create or replace function public.bump_ai_usage_pair(
  p_user_id uuid,
  p_day     date default current_date
)
returns table (user_count integer, global_count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ai_usage (day, user_id, count)
  values (p_day, p_user_id, 1)
  on conflict (day, user_id) do update set count = public.ai_usage.count + 1
  returning public.ai_usage.count into user_count;

  insert into public.ai_usage_global (day, count)
  values (p_day, 1)
  on conflict (day) do update set count = public.ai_usage_global.count + 1
  returning public.ai_usage_global.count into global_count;

  return next;
end;
$$;

revoke execute on function public.bump_ai_usage_pair(uuid, date) from public, anon, authenticated;
grant execute on function public.bump_ai_usage_pair(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- record_day_pass(pact, day, proof, delta) -> new vitality, or NULL when the day
-- was not open (already PASSED, or MISSED). Raises 40001 if the pact is not
-- ACTIVE, which also rolls back the day update.
-- ---------------------------------------------------------------------------
create or replace function public.record_day_pass(
  p_pact_id   uuid,
  p_day_index integer,
  p_proof_id  uuid,
  p_delta     double precision
)
returns double precision
language plpgsql
security definer
set search_path = public
as $$
declare
  new_vitality double precision;
begin
  if p_delta is null or p_delta <= 0 or p_delta > 1 then
    raise exception 'record_day_pass: delta % out of range', p_delta using errcode = '22023';
  end if;

  update public.pact_days
     set status = 'PASSED', passed_proof_id = p_proof_id
   where pact_id = p_pact_id
     and day_index = p_day_index
     and status in ('PENDING', 'UNCLEAR');
  if not found then
    return null;
  end if;

  -- Rounded to 4 dp to match packages/core roundVitality(); the column is
  -- double precision and 0.15 + 0.18 is not 0.33 in binary.
  update public.pacts
     set vitality = round(least(1, greatest(0, vitality + p_delta))::numeric, 4)::double precision
   where id = p_pact_id
     and status = 'ACTIVE'
  returning vitality into new_vitality;

  if new_vitality is null then
    raise exception 'record_day_pass: pact % is not ACTIVE', p_pact_id using errcode = '40001';
  end if;
  return new_vitality;
end;
$$;

revoke execute on function public.record_day_pass(uuid, integer, uuid, double precision) from public, anon, authenticated;
grant execute on function public.record_day_pass(uuid, integer, uuid, double precision) to service_role;
