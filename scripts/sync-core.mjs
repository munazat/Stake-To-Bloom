#!/usr/bin/env node
/**
 * sync-core.mjs — copy packages/core/src into supabase/functions/_shared/core.
 *
 * Supabase Edge Functions can only bundle files under supabase/functions, so the
 * shared pure-TS core is synced (and committed) there. Run this whenever
 * packages/core changes and before any `supabase functions deploy`.
 *
 * Usage: node scripts/sync-core.mjs   (or: npm run sync-core)
 */
import { cp, rm, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const src = resolve(root, 'packages/core/src')
const dest = resolve(root, 'supabase/functions/_shared/core')

await rm(dest, { recursive: true, force: true })
await mkdir(dest, { recursive: true })
await cp(src, dest, { recursive: true })

await writeFile(
  resolve(dest, '_SYNCED.md'),
  '# Generated — do not edit\n\nThis directory is a synced copy of `packages/core/src`.\nRegenerate with `npm run sync-core`.\n',
  'utf8',
)

console.log('synced packages/core/src -> supabase/functions/_shared/core')
