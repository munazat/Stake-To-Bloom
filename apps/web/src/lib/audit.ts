/**
 * audit.ts — the live PayPal feed, read under RLS and POLLED.
 *
 * `paypal_events` is deliberately not in the Realtime publication (a money feed
 * over a WebSocket is not worth the risk, brief §6.3), so the page refetches on
 * an interval. Rows hold ids, amounts and statuses only; nothing here is an
 * email, and anything displayed is rendered as plain text.
 */
import { supabase } from './supabase.ts'
import { ensureSession } from './session.ts'

export interface AuditRow {
  id: number
  source: 'API' | 'WEBHOOK'
  eventType: string
  resourceId: string | null
  pactId: string | null
  status: string | null
  amountCents: number | null
  verified: boolean
  createdAt: string
}

interface Row {
  id: number
  source: 'API' | 'WEBHOOK'
  event_type: string
  resource_id: string | null
  pact_id: string | null
  status: string | null
  amount_cents: number | null
  verified: boolean
  created_at: string
}

export async function fetchAuditEvents(limit = 50): Promise<AuditRow[]> {
  if (!supabase) return []
  await ensureSession()
  const { data, error } = await supabase
    .from('paypal_events')
    .select('id,source,event_type,resource_id,pact_id,status,amount_cents,verified,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    source: r.source,
    eventType: r.event_type,
    resourceId: r.resource_id,
    pactId: r.pact_id,
    status: r.status,
    amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
    verified: r.verified,
    createdAt: r.created_at,
  }))
}

/** "munaza@example.com" -> "m***@example.com". Anything that is not an email is fully hidden. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return ''
  const at = email.lastIndexOf('@')
  if (at < 1 || at === email.length - 1) return '***'
  return `${email[0]}***${email.slice(at)}`
}
