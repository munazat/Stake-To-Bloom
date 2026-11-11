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
 * Usage: node scripts/check-functions.mjs          (or: npm run check:functions)
 *        node scripts/check-functions.mjs --test   (or: npm run test:functions)
 *
 * `--test` runs the `*_test.ts` files with `deno test` instead. Tests get env
 * access only (the SDK reads logging flags from the environment); no network,
 * no file system, so a test that tries to reach a real API fails instead of
 * quietly spending quota.
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
const testMode = process.argv.includes('--test')
const testFiles = files.filter((f) => f.endsWith('_test.ts'))
const config = ['--config', join(functionsDir, 'deno.json')]
const args = testMode
  ? ['test', '--allow-env', '--no-prompt', ...config, ...testFiles]
  : ['check', '--quiet', ...config, ...files]

if (testMode && testFiles.length === 0) {
  console.error('no *_test.ts files found under supabase/functions')
  process.exit(1)
}
console.log(`${deno} ${args[0]} — ${testMode ? testFiles.length : files.length} file(s) under supabase/functions`)
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
console.log(testMode ? 'edge function tests passed' : 'edge functions typecheck clean')
