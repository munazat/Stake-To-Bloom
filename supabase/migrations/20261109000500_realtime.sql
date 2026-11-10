-- ---------------------------------------------------------------------------
-- Realtime publication.
--
-- Supabase ships `supabase_realtime` with no member tables, so a postgres_changes
-- subscription to a table that was never added connects successfully and then
-- delivers nothing at all — no error, no rows. The garden depends on this to plant
-- a seed the moment a pact is funded, without a page refresh.
--
-- Only the two tables the garden reads are published. Publishing money tables
-- would broadcast ledger and payout rows to every subscriber for RLS to filter,
-- which is needless exposure for data the client re-reads over REST anyway.
--
-- Every statement is guarded so the migration is replayable: ADD TABLE raises if
-- the table is already a member.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

do $$
declare
  target text;
begin
  foreach target in array array['pacts', 'pact_days'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end
$$;

-- Default replica identity sends only the primary key on DELETE. That is enough
-- here: the client treats every event as "re-read this pact" and never applies a
-- payload locally, because vitality is server-owned (blueprint §8.1).