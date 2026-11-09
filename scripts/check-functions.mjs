#!/usr/bin/env node
/**
 * check-functions.mjs — typecheck the Supabase Edge Functions with Deno.
 *
 * `npm run typecheck` covers the Node workspaces via tsc, but the functions run
 * under Deno: they import `npm:` specifiers and use `.ts`-suffixed relative
 * imports, so tsc never sees them. Nothing typechecked them at all until now,
 * which is how a missing `await` on an async `ruleHash()` reached production
 * code — it inserted a Promise, PostgREST serialised it as `{}`, and the failure
 * only surfaced as an opaque Postgres CHECK violation.
 *
 * Missing Deno is a hard failure, not a skip. A check that silently no-ops in
 * the one environment where it matters is worse than no check, because it reads
 * as a pass.
 *
 * Usage: node scripts/check-functions.mjs   (or: npm run check:functions)
 */
import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const functionsDir = resolve(root, 'supabase/functions')

async function collectTypeScript(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await collectTypeScript(full)))
    else if (entry.isFile() && entry.name.endsWith('.ts')) found.push(full)
  }
  return found.sort()
}

function findDeno() {
  if (process.env.DENO_BIN) return process.env.DENO_BIN
  const bundled = join(root, '.tools', process.platform === 'win32' ? 'deno.exe' : 'deno')
  if (existsSync(bundled)) return bundled
  return 'deno'
}

const files = await collectTypeScript(functionsDir)
if (files.length === 0) {
  console.error(`no .ts files found under ${relative(root, functionsDir)}`)
  process.exit(1)
}

const deno = findDeno()
const args = ['check', '--quiet', '--config', join(functionsDir, 'deno.json'), ...files]

console.log(`${deno} check — ${files.length} file(s) under supabase/functions`)
const result = spawnSync(deno, args, { cwd: root, stdio: 'inherit' })

if (result.error) {
  console.error(
    `\nCould not run Deno (${result.error.message}).\n` +
      'Install it from https://deno.land or drop the binary at .tools/deno,\n' +
      'or point DENO_BIN at an existing install.',
  )
  process.exit(1)
}

if (result.status !== 0) process.exit(result.status ?? 1)
console.log('edge functions typecheck clean')
