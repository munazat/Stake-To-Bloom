alter table public.pacts
  add column is_simulated boolean not null default false,
  add column demo_role text check (demo_role is null or demo_role in ('OWNER', 'MIA', 'OMAR', 'ZED'));
alter table public.pools add column demo_advanced_days integer not null default 0 check (demo_advanced_days between 0 and 7);
alter table public.pact_days add column demo_simulated boolean not null default false;

create table public.request_counters (
  scope text not null check (scope in ('USER', 'IP')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  bucket_start timestamptz not null,
  count integer not null check (count >= 0),
  primary key (scope, key_hash, bucket_start)
);
alter table public.request_counters enable row level security;
revoke all on public.request_counters from public, anon, authenticated;

create or replace function public.bump_request_counter(
  p_scope text,
  p_key_hash text,
  p_bucket_start timestamptz,
  p_limit integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare new_count integer;
begin
  if p_scope not in ('USER', 'IP') or p_key_hash !~ '^[0-9a-f]{64}$' or p_limit < 1 then
    raise exception 'invalid rate limit input' using errcode = '22023';
  end if;
  insert into public.request_counters(scope,key_hash,bucket_start,count)
  values (p_scope,p_key_hash,p_bucket_start,1)
  on conflict (scope,key_hash,bucket_start)
  do update set count = public.request_counters.count + 1
    where public.request_counters.count < p_limit
  returning count into new_count;
  return coalesce(new_count, 0);
end;
$$;
revoke execute on function public.bump_request_counter(text,text,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.bump_request_counter(text,text,timestamptz,integer) to service_role;

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
      when p.demo_role = 'MIA' then 'PASSED'::public.day_status
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

create or replace function public.close_elapsed_days(p_now timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare closed integer;
begin
  with changed as (
    update public.pact_days d set status = 'MISSED'
    from public.pacts p
    where p.id = d.pact_id and p.status = 'ACTIVE' and p.is_demo = false
      and d.status = 'PENDING'
      and d.date_local < (p_now at time zone p.tz)::date
    returning d.pact_id
  ), counts as (
    select pact_id, count(*)::integer as misses from changed group by pact_id
  ), totals as (
    select coalesce(sum(misses), 0)::integer as days_closed from counts
  ), updated as (
  update public.pacts p set vitality = greatest(0, round((p.vitality - 0.25 * counts.misses)::numeric, 4)::double precision)
  from counts where p.id = counts.pact_id
  returning p.id
  )
  select days_closed into closed from totals;
  return closed;
end;
$$;
revoke execute on function public.close_elapsed_days(timestamptz) from public, anon, authenticated;
grant execute on function public.close_elapsed_days(timestamptz) to service_role;

create index pacts_active_user_idx on public.pacts(user_id) where status in ('AWAITING_STAKE','ACTIVE','SETTLING','NEEDS_REVIEW');
create index proofs_created_at_idx on public.proofs(created_at);

create or replace function public.enforce_active_pact_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare active_count integer;
begin
  if new.is_simulated or new.status not in ('AWAITING_STAKE','ACTIVE','SETTLING','NEEDS_REVIEW') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  select count(*) into active_count from public.pacts p
   where p.user_id = new.user_id and p.is_simulated = false
     and p.status in ('AWAITING_STAKE','ACTIVE','SETTLING','NEEDS_REVIEW')
     and p.id is distinct from new.id;
  if active_count >= 3 then
    raise exception 'user active pact limit reached' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger pacts_active_limit
  before insert or update of status on public.pacts
  for each row execute function public.enforce_active_pact_limit();
