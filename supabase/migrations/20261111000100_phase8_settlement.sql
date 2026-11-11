-- Atomically claim or finalize every pact represented by a pool settlement.
-- A partial compare-and-set must roll back as a unit; otherwise concurrent workers
-- could leave only some members in SETTLING.
create or replace function public.transition_pacts(
  p_pact_ids uuid[],
  p_from public.pact_status,
  p_to public.pact_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expected integer;
  moved integer;
begin
  if p_pact_ids is null or cardinality(p_pact_ids) = 0 then
    raise exception 'pact ids are required' using errcode = '22023';
  end if;
  select count(distinct id) into expected from unnest(p_pact_ids) as ids(id);
  update public.pacts set status = p_to
   where id = any(p_pact_ids) and status = p_from;
  get diagnostics moved = row_count;
  if moved <> expected then
    raise exception 'one or more pacts changed before transition' using errcode = '40001';
  end if;
  if p_to in ('SETTLED_PASS', 'SETTLED_FAIL') then
    update public.pact_days
       set status = 'MISSED'
     where pact_id = any(p_pact_ids)
       and status = 'PENDING';
    update public.pacts
       set vitality = case when p_to = 'SETTLED_PASS' then 1.0 else 0.0 end
     where id = any(p_pact_ids);
  end if;
end;
$$;

revoke execute on function public.transition_pacts(uuid[], public.pact_status, public.pact_status) from public, anon, authenticated;
grant execute on function public.transition_pacts(uuid[], public.pact_status, public.pact_status) to service_role;
