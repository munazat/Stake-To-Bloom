/**
 * submit-proof — the AI proof referee's front door.
 *
 * Body: { pact_id, storage_path }. Nothing else is read from the client: not the
 * day, not a timestamp, not a verdict, not the user id (invariant I2). The
 * decision logic lives in pipeline.ts; this file only wires it to Postgres,
 * Storage and the model chain, all through the service role.
 */
import { z } from 'zod'
import { ObservationSchema, type Observation } from '../_shared/core/index.ts'
import { requireUserId, serviceClient } from '../_shared/auth.ts'
import { depsFromEnv, extractObservation } from '../_shared/gemini.ts'
import { assertMethod, json, readJsonBody, withCors } from '../_shared/http.ts'
import { PASS_DELTA, runProofPipeline, type ProofDeps } from './pipeline.ts'

const RequestSchema = z.object({
  pact_id: z.string().uuid(),
  storage_path: z.string().min(1).max(200),
})

function intEnv(name: string, fallback: number): number {
  const n = Number(Deno.env.get(name))
  return Number.isInteger(n) && n > 0 ? n : fallback
}

function fail(what: string, error: unknown): never {
  // Logged without the row contents: they may hold model output or paths.
  console.error(`submit-proof: ${what} failed:`, (error as { code?: string })?.code ?? error)
  throw new Error(`${what} failed`)
}

const handler = async (request: Request): Promise<Response> => {
  assertMethod(request, 'POST')
  const admin = serviceClient()
  const userId = await requireUserId(request, admin)
  const body = RequestSchema.parse(await readJsonBody(request))
  const gemini = depsFromEnv()

  const deps: ProofDeps = {
    now: () => new Date(),

    async loadPact(pactId) {
      const { data, error } = await admin
        .from('pacts')
        .select('id, user_id, status, tz, starts_at, is_demo, virtual_day_offset, rule_spec')
        .eq('id', pactId)
        .maybeSingle()
      if (error) fail('load pact', error)
      return data
    },

    async loadDay(pactId, dayIdx) {
      const { data, error } = await admin
        .from('pact_days')
        .select('status, date_local')
        .eq('pact_id', pactId)
        .eq('day_index', dayIdx)
        .maybeSingle()
      if (error) fail('load day', error)
      return data
    },

    async countAttempts(pactId, dayIdx) {
      const { count, error } = await admin
        .from('proofs')
        .select('id', { count: 'exact', head: true })
        .eq('pact_id', pactId)
        .eq('day_index', dayIdx)
      if (error) fail('count attempts', error)
      return count ?? 0
    },

    async download(path) {
      const { data, error } = await admin.storage.from('proofs').download(path)
      if (error || !data) return null
      return new Uint8Array(await data.arrayBuffer())
    },

    async hashSeen(pactId, sha256) {
      const { data, error } = await admin
        .from('proofs')
        .select('id')
        .eq('pact_id', pactId)
        .eq('sha256', sha256)
        .limit(1)
      if (error) fail('duplicate check', error)
      return (data?.length ?? 0) > 0
    },

    async aiEnabled() {
      const { data, error } = await admin.from('app_config').select('value').eq('key', 'ai_enabled').maybeSingle()
      if (error) fail('read ai_enabled', error)
      return data?.value === true
    },

    async bumpUsage(uid) {
      const { data, error } = await admin.rpc('bump_ai_usage_pair', { p_user_id: uid })
      if (error) fail('bump ai usage', error)
      const row = Array.isArray(data) ? data[0] : data
      return { user: Number(row?.user_count ?? Infinity), global: Number(row?.global_count ?? Infinity) }
    },

    caps: { user: intEnv('AI_DAILY_CAP_USER', 8), global: intEnv('AI_DAILY_CAP_GLOBAL', 300) },

    extract: (input) => extractObservation(input, gemini),

    async cachedObservation(sha256) {
      const { data, error } = await admin
        .from('verdict_cache')
        .select('model, observation')
        .eq('sha256', sha256)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) fail('read verdict cache', error)
      const row = data?.[0]
      const parsed = row ? ObservationSchema.safeParse(row.observation) : null
      return row && parsed?.success ? { observation: parsed.data as Observation, model: String(row.model) } : null
    },

    async saveCache(sha256, model, verdict, observation) {
      const { error } = await admin
        .from('verdict_cache')
        .upsert({ sha256, model, verdict, observation }, { onConflict: 'sha256,model' })
      // A cache write is an optimisation; never fail a judged proof over it.
      if (error) console.error('submit-proof: cache write failed:', error.code)
    },

    async insertProof(row) {
      const { data, error } = await admin.from('proofs').insert(row).select('id').single()
      if (error?.code === '23505') return 'duplicate'
      if (error || !data) fail('insert proof', error)
      return { id: data.id as string }
    },

    async recordPass(pactId, dayIdx, proofId) {
      const { data, error } = await admin.rpc('record_day_pass', {
        p_pact_id: pactId,
        p_day_index: dayIdx,
        p_proof_id: proofId,
        p_delta: PASS_DELTA,
      })
      if (error) fail('record day pass', error)
      return typeof data === 'number' ? data : null
    },

    async markDayUnclear(pactId, dayIdx) {
      const { error } = await admin
        .from('pact_days')
        .update({ status: 'UNCLEAR' })
        .eq('pact_id', pactId)
        .eq('day_index', dayIdx)
        .eq('status', 'PENDING')
      if (error) fail('mark day unclear', error)
    },
  }

  const outcome = await runProofPipeline(deps, userId, body.pact_id, body.storage_path)
  return json({ proof: outcome }, outcome.outcome === 'judged' || outcome.outcome === 'queued' ? 201 : 200)
}

Deno.serve(withCors(handler))
