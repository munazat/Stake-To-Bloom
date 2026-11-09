# Shared Edge Function code lives here.
#
# Later phases add: paypal.ts, gemini.ts, guard.ts, auth.ts, cors.ts, prompt.ts.
#
# `core/` is NOT hand-written — it is a synced copy of packages/core/src, produced
# by `npm run sync-core` (scripts/sync-core.mjs). Edge Functions can only bundle
# files under supabase/functions, so the copy is committed. Run sync-core before
# deploying whenever packages/core changes.
