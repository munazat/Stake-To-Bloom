# Phase 10 runbook

This runbook separates repeatable local checks from account actions that require the owner. The hosted ref is known (`jcooxuagqgapjfedhdpz`); hosted credentials and buyer credentials are not in this repository.

## Local acceptance (repeatable)

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run check:functions`
5. `npm run test:functions`
6. `npm run build`
7. `supabase start`, `supabase migration up`, `supabase test db`
8. Exercise the guided demo at `/demo`: start, submit one generated sample proof, advance seven days, inspect the simulated settlement receipt, and confirm every simulated day/stake is labelled.
9. Run the local security checklist in `docs/phase10-submission.md`.

## Owner setup still required

- Wire hosted Supabase using the project's database password and anon/publishable key. Keep the service-role key private.
- Set function secrets from `.env.example` in the hosted Supabase project. `ADMIN_SECRET`, `CRON_SECRET`, and `RATE_LIMIT_SALT` must be generated privately; never paste them into chat or commit them.
- Verify PayPal Sandbox Payouts is enabled, create/confirm `charity-demo` and buyer accounts, register the hosted webhook, and set `PAYPAL_WEBHOOK_ID`. Live acceptance requires the owner’s explicit decision to run sandbox calls.
- Add GitHub Actions secrets `SUPABASE_PROJECT_URL` and `CRON_SECRET`. `keepalive.yml` deliberately reports a no-op when these are absent; a green no-op is not live acceptance.
- Connect Cloudflare Pages to this repository with build command `npm run build --workspace @bloomstake/web`, output directory `apps/web/dist`, and public build variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PAYPAL_CLIENT_ID`. Keep `VITE_PAYMENTS_ADAPTER` empty for hosted builds.
- Apply migrations and deploy functions only after hosted settings are checked. Start with `payments_enabled=false` and `settlement_enabled=false`.
- Run the hosted acceptance and 15-row chaos checklist before sharing the URL.
- Test on a physical phone over mobile data, Safari and Firefox. Confirm lite/reduced-motion and SVG fallback.

## Operations notes

`keepalive.yml` schedules the hourly maintenance tick, daily health check, and additional three-day tick. GitHub can disable scheduled workflows after 60 days without repository activity. The purge endpoint preserves all guest proof data until 16 Dec 2026, then removes only demo proof images/records older than 14 days.

The submission deadline printed in the original brief is 12 Nov 2026 20:00 UTC. Verify the actual event status before making any submission claim; the repository code cannot verify Devpost account eligibility.
