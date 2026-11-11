/**
 * events.ts — rows for the live audit feed (`paypal_events`).
 *
 * `public_payload` is what the /audit page shows to the signed-in owner, so it
 * is built from an allowlist: ids, amounts and statuses only. Never an email,
 * a token, a header or a raw PayPal body (blueprint §3.9).
 */

export interface AuditEvent {
  source: 'API' | 'WEBHOOK'
  eventId?: string | null
  eventType: string
  resourceId?: string | null
  pactId?: string | null
  status?: string | null
  amountCents?: number | null
  verified: boolean
  /** Extra, already-safe fields (ids/statuses). */
  detail?: Record<string, string | number | boolean | null>
}

export interface EventSink {
  record(event: AuditEvent): Promise<'recorded' | 'duplicate'>
  /** True when a webhook event with this id has already been processed. */
  seen(eventId: string): Promise<boolean>
}

// deno-lint-ignore no-explicit-any
export function supabaseEventSink(admin: any): EventSink {
  return {
    async record(e) {
      const { error } = await admin.from('paypal_events').insert({
        source: e.source,
        event_id: e.eventId ?? null,
        event_type: e.eventType,
        resource_id: e.resourceId ?? null,
        pact_id: e.pactId ?? null,
        status: e.status ?? null,
        amount_cents: e.amountCents ?? null,
        verified: e.verified,
        public_payload: e.detail ?? {},
      })
      if (error?.code === '23505') return 'duplicate'
      if (error) {
        console.error('events: insert failed:', error.code)
        throw new Error('record event failed')
      }
      return 'recorded'
    },
    async seen(eventId) {
      const { data, error } = await admin.from('paypal_events').select('id').eq('event_id', eventId).limit(1)
      if (error) throw new Error('read event failed')
      return (data?.length ?? 0) > 0
    },
  }
}
