/**
 * pactDetail.ts — read one pact with its days and proof history, under RLS.
 * Everything here is a read; the browser cannot write any of these tables.
 */
import {
  RuleSpecSchema,
  dailyCode,
  dayIndex,
  localDateKey,
  type PactStatus,
  type RuleSpec,
  type Verdict,
} from '@bloomstake/core'
import { supabase } from './supabase.ts'
import { ensureSession } from './session.ts'
import type { DayStatus } from './garden.ts'

export interface PactDay {
  dayIndex: number
  dateLocal: string
  status: DayStatus
  demoSimulated: boolean
}

export interface ProofRecord {
  id: string
  dayIndex: number
  attemptNo: number
  verdict: Verdict | null
  reasons: string[]
  injectionFlag: boolean
  cached: boolean
  queued: boolean
  createdAt: string
}

export interface PactDetail {
  id: string
  title: string
  status: PactStatus
  vitality: number
  stakeCents: number
  currency: string
  requiredPasses: number
  days: number
  tz: string
  startsAt: string | null
  isDemo: boolean
  isSimulated: boolean
  demoRole: string | null
  poolId: string | null
  ruleHash: string
  spec: RuleSpec
  paypalOrderId: string | null
  payerEmail: string | null
  settlement: {
    status: string
    plan: Record<string, unknown>
    planHash: string
    senderBatchId: string | null
    payoutBatchId: string | null
  } | null
  dayRows: PactDay[]
  proofs: ProofRecord[]
}

interface PactRow {
  id: string
  title: string
  status: PactStatus
  vitality: number
  stake_cents: number
  currency: string
  required_passes: number
  days: number
  tz: string
  starts_at: string | null
  is_demo: boolean
  is_simulated: boolean
  demo_role: string | null
  pool_id: string | null
  rule_hash: string
  rule_spec: unknown
  paypal_order_id: string | null
  payer_email: string | null
  pact_days: Array<{
    day_index: number
    date_local: string
    status: DayStatus
    demo_simulated: boolean
  }> | null
}

interface ProofRow {
  id: string
  day_index: number
  attempt_no: number
  final_status: Verdict | null
  injection_flag: boolean
  gate_result: { reasons?: unknown; cached?: unknown; queued?: unknown } | null
  created_at: string
}

const PACT_COLUMNS =
  'id,title,status,vitality,stake_cents,currency,required_passes,days,tz,starts_at,is_demo,is_simulated,demo_role,pool_id,rule_hash,rule_spec,paypal_order_id,payer_email,pact_days(day_index,date_local,status,demo_simulated)'

export async function fetchPactDetail(id: string): Promise<PactDetail | null> {
  if (!supabase) return null
  await ensureSession()

  const { data: pact, error } = await supabase
    .from('pacts')
    .select(PACT_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!pact) return null
  const row = pact as unknown as PactRow

  const { data: proofRows, error: proofError } = await supabase
    .from('proofs')
    .select('id,day_index,attempt_no,final_status,injection_flag,gate_result,created_at')
    .eq('pact_id', id)
    .order('created_at', { ascending: false })
  if (proofError) throw new Error(proofError.message)

  const { data: settlementRow, error: settlementError } = await supabase
    .from('settlements')
    .select('status,plan,plan_hash,sender_batch_id,payout_batch_id')
    .eq(row.pool_id ? 'pool_id' : 'pact_id', row.pool_id ?? id)
    .maybeSingle()
  if (settlementError) throw new Error(settlementError.message)

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    vitality: row.vitality,
    stakeCents: Number(row.stake_cents),
    currency: row.currency,
    requiredPasses: row.required_passes,
    days: row.days,
    tz: row.tz,
    startsAt: row.starts_at,
    isDemo: row.is_demo,
    isSimulated: row.is_simulated,
    demoRole: row.demo_role,
    poolId: row.pool_id,
    ruleHash: row.rule_hash,
    spec: RuleSpecSchema.parse(row.rule_spec),
    paypalOrderId: row.paypal_order_id,
    payerEmail: row.payer_email,
    settlement: settlementRow
      ? {
          status: settlementRow.status,
          plan: settlementRow.plan as Record<string, unknown>,
          planHash: settlementRow.plan_hash,
          senderBatchId: settlementRow.sender_batch_id,
          payoutBatchId: settlementRow.payout_batch_id,
        }
      : null,
    dayRows: (row.pact_days ?? [])
      .map((d) => ({
        dayIndex: d.day_index,
        dateLocal: d.date_local,
        status: d.status,
        demoSimulated: d.demo_simulated,
      }))
      .sort((a, b) => a.dayIndex - b.dayIndex),
    proofs: ((proofRows ?? []) as unknown as ProofRow[]).map((p) => ({
      id: p.id,
      dayIndex: p.day_index,
      attemptNo: p.attempt_no,
      verdict: p.final_status,
      reasons: Array.isArray(p.gate_result?.reasons)
        ? p.gate_result.reasons.filter((r): r is string => typeof r === 'string')
        : [],
      injectionFlag: p.injection_flag,
      cached: p.gate_result?.cached === true,
      queued: p.gate_result?.queued === true,
      createdAt: p.created_at,
    })),
  }
}

/**
 * Today's day index for display and for naming the upload. Display only: the
 * server assigns the real day from its own clock, so a wrong device clock here
 * can mislabel a card but can never move a proof to a different day.
 */
export function todayIndex(
  detail: Pick<PactDetail, 'startsAt' | 'tz' | 'days'>,
  now = new Date(),
): number | null {
  if (!detail.startsAt) return null
  const idx = dayIndex(detail.startsAt, now, detail.tz)
  return idx >= 0 && idx < detail.days ? idx : null
}

export function sampleContextFor(
  detail: Pick<PactDetail, 'id' | 'tz'>,
  idx: number,
  now = new Date(),
) {
  return { dateKey: localDateKey(now, detail.tz), dailyCode: dailyCode(detail.id, idx) }
}
