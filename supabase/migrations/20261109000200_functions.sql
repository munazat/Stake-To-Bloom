-- 20261109000200_functions.sql — state machine, guards, and counters (§5.1, §6.1).
--
-- These enforce the money-critical rules IN THE DATABASE, not just in app code:
--   * transition_pact() — compare-and-set a pact status; raises on a stale/illegal move.
--   * pact_status_guard — trigger rejecting any illegal status edge (even direct writes).
--   * pact_frozen_after_funding — trigger rejecting edits to stake/rule/hash/currency once funded.
--   * ledger_append_only — trigger making ledger_entries insert-only.
--   * bump_ai_usage() — atomic per-user + global daily AI counter.
--   * handle_new_user() — auto-create a profile on first sign-in.
-- Security-definer helpers have EXECUTE revoked from client roles; only service_role calls them.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at   before update on public.profiles   for each row execute function public.set_updated_at();
create trigger pacts_set_updated_at      before update on public.pacts      for each row execute function public.set_updated_at();
create trigger settlements_set_updated_at before update on public.settlements for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- transition_pact(pact_id, from, to): compare-and-set the status.
-- Raises unless exactly one row moved from `from` to `to`, which gives free
-- protection against races and double-clicks (invariant I5).
-- ---------------------------------------------------------------------------
create or replace function public.transition_pact(
  p_pact_id uuid,
  p_from    public.pact_status,
  p_to      public.pact_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  moved integer;
begin
  update public.pacts
     set status = p_to
   where id = p_pact_id
     and status = p_from;
  get diagnostics moved = row_count;
  if moved <> 1 then
    raise exception 'illegal or stale pact transition % -> % for pact %', p_from, p_to, p_pact_id
      using errcode = '40001'; -- serialization_failure: caller should re-read and retry/abort
  end if;
end;
$$;

revoke execute on function public.transition_pact(uuid, public.pact_status, public.pact_status) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Legal edges of the state machine (§5.1). Used by the guard trigger so even a
-- direct UPDATE cannot skip states.
-- ---------------------------------------------------------------------------
create or replace function public.pact_status_is_legal(
  p_from public.pact_status,
  p_to   public.pact_status
)
returns boolean
language sql
immutable
as $$
  select (p_from, p_to) in (
    ('DRAFT',            'AWAITING_STAKE'),
    ('AWAITING_STAKE',   'ACTIVE'),
    ('AWAITING_STAKE',   'EXPIRED'),
    ('AWAITING_STAKE',   'CANCELLED_REFUNDED'),
    ('DRAFT',            'CANCELLED_REFUNDED'),
    ('ACTIVE',           'CANCELLED_REFUNDED'),
    ('ACTIVE',           'SETTLING'),
    ('ACTIVE',           'NEEDS_REVIEW'),
    ('SETTLING',         'SETTLED_PASS'),
    ('SETTLING',         'SETTLED_FAIL'),
    ('SETTLING',         'NEEDS_REVIEW'),
    ('NEEDS_REVIEW',     'SETTLING'),
    ('NEEDS_REVIEW',     'SETTLED_PASS'),
    ('NEEDS_REVIEW',     'SETTLED_FAIL'),
    ('NEEDS_REVIEW',     'CANCELLED_REFUNDED')
  );
$$;

create or replace function public.pact_status_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and not public.pact_status_is_legal(old.status, new.status) then
    raise exception 'illegal pact status transition % -> %', old.status, new.status
      using errcode = '22023'; -- invalid_parameter_value
  end if;
  return new;
end;
$$;

create trigger pacts_status_guard
  before update on public.pacts
  for each row execute function public.pact_status_guard();

-- ---------------------------------------------------------------------------
-- Freeze the money-critical fields once a pact is past AWAITING_STAKE (I9: the
-- rule spec is frozen at funding). stake_cents, rule_spec, rule_hash, currency.
-- ---------------------------------------------------------------------------
create or replace function public.pact_frozen_after_funding()
returns trigger
language plpgsql
as $$
begin
  if old.status not in ('DRAFT', 'AWAITING_STAKE') then
    if new.stake_cents is distinct from old.stake_cents
       or new.rule_spec is distinct from old.rule_spec
       or new.rule_hash is distinct from old.rule_hash
       or new.currency   is distinct from old.currency then
      raise exception 'pact % is funded; stake_cents/rule_spec/rule_hash/currency are immutable', old.id
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger pacts_frozen_after_funding
  before update on public.pacts
  for each row execute function public.pact_frozen_after_funding();

-- ---------------------------------------------------------------------------
-- ledger_entries is append-only: reject UPDATE and DELETE for everyone.
-- ---------------------------------------------------------------------------
create or replace function public.ledger_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ledger_entries is append-only; % is not allowed', tg_op
    using errcode = '22023';
end;
$$;

create trigger ledger_no_update
  before update on public.ledger_entries
  for each row execute function public.ledger_append_only();

create trigger ledger_no_delete
  before delete on public.ledger_entries
  for each statement execute function public.ledger_append_only();

-- ---------------------------------------------------------------------------
-- bump_ai_usage(user_id, day): atomically increment the per-user and global daily
-- counters and return the user's new count (caller enforces the cap).
-- ---------------------------------------------------------------------------
create or replace function public.bump_ai_usage(
  p_user_id uuid,
  p_day     date default current_date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.ai_usage (day, user_id, count)
  values (p_day, p_user_id, 1)
  on conflict (day, user_id) do update set count = public.ai_usage.count + 1
  returning count into new_count;

  insert into public.ai_usage_global (day, count)
  values (p_day, 1)
  on conflict (day) do update set count = public.ai_usage_global.count + 1;

  return new_count;
end;
$$;

revoke execute on function public.bump_ai_usage(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- handle_new_user(): auto-create a profile row the first time a user signs in
-- (including anonymous sign-ins). Runs as the trigger owner, bypassing RLS.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, is_guest)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'is_guest', 'false')::boolean = true)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
