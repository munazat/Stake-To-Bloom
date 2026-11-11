/**
 * garden.ts — reading plots, and keeping them live.
 *
 * Vitality is server-owned (blueprint §8.1). A Realtime event is therefore used
 * only as a signal to re-read the row, never as a source of numbers to apply
 * locally: patching the payload client-side would let the browser's arithmetic
 * diverge from the server's, and the garden would show a stage the ledger disagrees
 * with. The client derives the *visual* stage and nothing else.
 */
import { gardenStage, type GardenStage, type PactStatus } from '@bloomstake/core'
import { supabase } from './supabase.ts'
import { ensureSession } from './session.ts'

export type DayStatus = 'PENDING' | 'PASSED' | 'MISSED' | 'UNCLEAR'

interface PlotRow {
  id: string
  title: string
  status: PactStatus
  vitality: number
  stake_cents: number
  currency: string
  required_passes: number
  days: number
  funded_at: string | null
  is_demo: boolean
  is_simulated: boolean
  demo_role: string | null
  pact_days: Array<{ day_index: number; status: DayStatus }> | null
}

export interface Plot {
  id: string
  title: string
  status: PactStatus
  vitality: number
  stakeCents: number
  currency: string
  requiredPasses: number
  days: number
  isDemo: boolean
  isSimulated: boolean
  demoRole: string | null
  passedDays: number
  stage: GardenStage
}

const PLOT_COLUMNS =
  'id,title,status,vitality,stake_cents,currency,required_passes,days,funded_at,is_demo,is_simulated,demo_role,pact_days(day_index,status)'

export function toPlot(row: PlotRow): Plot {
  const days = row.pact_days ?? []
  const resolved = days.filter((day) => day.status !== 'PENDING')
  const passedDays = days.filter((day) => day.status === 'PASSED').length
  // Wilting is "a miss just happened", so it is the last resolved day that decides,
  // not whether any day was ever missed — otherwise a recovered plant droops forever.
  const latest = resolved.reduce<{ day_index: number; status: DayStatus } | null>(
    (best, day) => (best === null || day.day_index > best.day_index ? day : best),
    null,
  )

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    vitality: row.vitality,
    stakeCents: row.stake_cents,
    currency: row.currency,
    requiredPasses: row.required_passes,
    days: row.days,
    isDemo: row.is_demo,
    isSimulated: row.is_simulated,
    demoRole: row.demo_role,
    passedDays,
    stage: gardenStage({
      vitality: row.vitality,
      status: row.status,
      hasProof: resolved.length > 0,
      wilting: latest?.status === 'MISSED',
    }),
  }
}

export async function fetchPlots(): Promise<Plot[]> {
  if (!supabase) return []
  await ensureSession()
  const { data, error } = await supabase
    .from('pacts')
    .select(PLOT_COLUMNS)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as PlotRow[]).map(toPlot)
}

/**
 * Watch the two tables that can change a plot. Returns an unsubscribe function.
 * The channel is authenticated explicitly: RLS filters what a subscriber receives,
 * and an unauthenticated socket would silently deliver nothing.
 */
export async function subscribeToPlots(onChange: () => void): Promise<() => void> {
  if (!supabase) return () => {}
  const session = await ensureSession()
  await supabase.realtime.setAuth(session.access_token)

  const channel = supabase
    .channel(`garden:${session.user.id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pacts', filter: `user_id=eq.${session.user.id}` },
      onChange,
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pact_days' }, onChange)
    .subscribe()

  return () => {
    void supabase?.removeChannel(channel)
  }
}
