import { serviceClient } from '../_shared/auth.ts'
import { assertMethod, HttpError, json, withCors } from '../_shared/http.ts'

const handler = async (request: Request) => {
  assertMethod(request, 'POST')
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`)
    throw new HttpError(401, 'unauthorized', 'A valid cron secret is required.')
  const now = new Date()
  // Preserve all guest data through the stated submission-review window.
  if (now < new Date('2026-12-16T00:00:00Z'))
    return json({ deleted: 0, skipped: 'guest-data-retention-window' })
  const admin = serviceClient()
  const { data: oldProofs, error } = await admin
    .from('proofs')
    .select('id,pact_id,storage_path,pacts!inner(is_demo)')
    .eq('pacts.is_demo', true)
    .lt('created_at', new Date(now.getTime() - 14 * 86_400_000).toISOString())
    .limit(500)
  if (error) throw new Error('load old demo proofs failed')
  let deleted = 0
  const byPact = new Map<string, typeof oldProofs>()
  for (const proof of oldProofs ?? [])
    byPact.set(proof.pact_id, [...(byPact.get(proof.pact_id) ?? []), proof])
  for (const [pactId, proofs] of byPact) {
    const paths = proofs.map((proof: any) => proof.storage_path)
    const removed = await admin.storage.from('proofs').remove(paths)
    if (removed.error) throw new Error('delete old demo images failed')
    const ids = proofs.map((proof: any) => proof.id)
    const result = await admin.from('proofs').delete().in('id', ids).eq('pact_id', pactId)
    if (result.error) throw new Error('delete old demo proof records failed')
    deleted += ids.length
  }
  return json({ deleted })
}
Deno.serve(withCors(handler))
