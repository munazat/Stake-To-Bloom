import { ruleHash, stepsSpec } from '../_shared/core/index.ts'
import { requireUserId, serviceClient } from '../_shared/auth.ts'
import { assertMethod, HttpError, json, withCors } from '../_shared/http.ts'
import { dayDates } from '../_shared/funding.ts'
import { enforceCounter, requestIp } from '../_shared/rateLimit.ts'

const handler = async (request: Request) => {
  assertMethod(request, 'POST')
  const admin = serviceClient()
  const userId = await requireUserId(request, admin)
  // Recreate a missing guest profile (see pact-create) so the demo pacts can be saved.
  await admin
    .from('profiles')
    .upsert({ user_id: userId, is_guest: true }, { onConflict: 'user_id', ignoreDuplicates: true })
  const existing = await admin
    .from('pacts')
    .select('id,pool_id')
    .eq('user_id', userId)
    .eq('is_demo', true)
    .eq('demo_role', 'OWNER')
    .in('status', ['ACTIVE', 'SETTLING', 'NEEDS_REVIEW'])
    .maybeSingle()
  if (existing.error) throw new Error('read existing demo failed')
  if (existing.data)
    return json({
      demo: true,
      pactId: existing.data.id,
      poolId: existing.data.pool_id,
      existing: true,
    })

  // Only a brand-new demo counts against the daily limit; reopening one never does.
  // The IP limit is generous because judges often share one office or campus address.
  await enforceCounter(admin, { scope: 'USER', value: userId, limit: 10 })
  await enforceCounter(admin, { scope: 'IP', value: requestIp(request), limit: 200 })

  const { data: pool, error: poolError } = await admin
    .from('pools')
    .insert({ name: 'BloomStake Guided Demo', is_demo: true, status: 'ACTIVE' })
    .select('id')
    .single()
  if (poolError || !pool)
    throw new HttpError(502, 'demo_unavailable', 'Could not start the guided demo.')
  try {
    const now = new Date()
    const end = new Date(now.getTime() + 7 * 86_400_000)
    const stakeCents = 2000
    const spec = stepsSpec({ threshold: 10_000, requiredPasses: 5 })
    const hash = await ruleHash(spec)
    const roles = ['OWNER', 'MIA', 'OMAR', 'ZED'] as const
    const pacts = []
    for (const role of roles) {
      const { data, error } = await admin
        .from('pacts')
        .insert({
          user_id: userId,
          pool_id: pool.id,
          goal_type: spec.goalType,
          title:
            role === 'OWNER'
              ? 'Your demo pact · 10,000 steps'
              : `${role[0]}${role.slice(1).toLowerCase()} · demo player`,
          rule_spec: spec,
          rule_hash: hash,
          stake_cents: stakeCents,
          currency: 'USD',
          required_passes: spec.requiredPasses,
          days: 7,
          status: 'ACTIVE',
          tz: 'UTC',
          starts_at: now.toISOString(),
          ends_at: end.toISOString(),
          funded_at: now.toISOString(),
          vitality: 0.15,
          is_demo: true,
          is_simulated: true,
          demo_role: role,
        })
        .select('id')
        .single()
      if (error || !data) throw new Error('create demo pact failed')
      pacts.push({ id: data.id, role })
    }
    const dateLocal = dayDates(now, 'UTC')
    const dayRows = pacts.flatMap(({ id }) =>
      dateLocal.map((date_local, day_index) => ({
        pact_id: id,
        day_index,
        date_local,
        status: 'PENDING',
      })),
    )
    const days = await admin.from('pact_days').insert(dayRows)
    if (days.error) throw new Error('create demo days failed')
    const entries = pacts.map(({ id, role }) => ({
      pact_id: id,
      kind: 'SIM_STAKE',
      amount_cents: stakeCents,
      ref: `demo-sim-stake-${pool.id}-${role.toLowerCase()}`,
    }))
    const ledger = await admin.from('ledger_entries').insert(entries)
    if (ledger.error) throw new Error('create demo stakes failed')
    return json(
      {
        demo: true,
        pactId: pacts.find((p) => p.role === 'OWNER')!.id,
        poolId: pool.id,
        pacts: pacts.map(({ id, role }) => ({ id, role, simulated: true })),
      },
      201,
    )
  } catch (error) {
    await admin.from('pacts').delete().eq('pool_id', pool.id)
    await admin.from('pools').delete().eq('id', pool.id)
    throw error
  }
}
Deno.serve(withCors(handler))
