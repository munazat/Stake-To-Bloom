-- Local dev seed. Runs automatically after migrations on `supabase db reset`.
-- Keeps local/demo state reproducible without any real user or PayPal data.

-- A demo pool so the garden and judge demo mode have somewhere to attach pacts.
insert into public.pools (id, name, is_demo, join_code, status)
values ('11111111-2222-4333-8444-555555555555', 'Demo Garden', true, 'DEMO123', 'ACTIVE')
on conflict (id) do nothing;

-- Local kill-switch defaults: AI on, real money off (no PayPal creds locally).
update public.app_config set value = 'true'::jsonb  where key = 'ai_enabled';
update public.app_config set value = 'false'::jsonb where key = 'payments_enabled';
update public.app_config set value = 'false'::jsonb where key = 'settlement_enabled';
