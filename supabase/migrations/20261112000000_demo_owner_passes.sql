-- Demo fast-forward: the player's own pact now passes its simulated days, like Mia's.
--
-- The first version only passed Mia and missed everyone else, which included the
-- player. After one real proof the player's plant therefore wilted at the end of the
-- demo instead of blooming. The player already passed day one with a real proof, so
-- the remaining simulated days follow the same outcome. Omar and Zed still miss.

create or replace function public.advance_demo_day(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare day_to_advance integer;
begin
  select demo_advanced_days into day_to_advance
    from public.pools where id = p_pool_id and is_demo = true and status = 'ACTIVE'
    for update;
  if day_to_advance is null then
    raise exception 'demo pool not found' using errcode = 'P0002';
  end if;
  if day_to_advance >= 7 then return 7; end if;

  update public.pact_days d set
    status = case
      when d.status = 'PASSED' then 'PASSED'::public.day_status
      when p.demo_role in ('OWNER', 'MIA') then 'PASSED'::public.day_status
      else 'MISSED'::public.day_status
    end,
    demo_simulated = (d.status <> 'PASSED')
  from public.pacts p
  where d.pact_id = p.id and p.pool_id = p_pool_id
    and d.day_index = day_to_advance and d.status = 'PENDING'
    and p.is_demo = true;

  update public.pacts p set vitality = greatest(0, least(1,
    round((p.vitality + case
      when d.status = 'PASSED' then 0.18
      else -0.25
    end)::numeric, 4)::double precision))
  from public.pact_days d
  where d.pact_id = p.id and p.pool_id = p_pool_id
    and d.day_index = day_to_advance and d.demo_simulated = true;

  update public.pools set demo_advanced_days = demo_advanced_days + 1 where id = p_pool_id;
  return day_to_advance;
end;
$$;
revoke execute on function public.advance_demo_day(uuid) from public, anon, authenticated;
grant execute on function public.advance_demo_day(uuid) to service_role;
