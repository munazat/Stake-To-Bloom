/**
 * lateCapture.ts — a captured payment for a pact that can no longer be funded.
 *
 * A buyer can approve and capture just as the 30-minute AWAITING_STAKE window
 * closes. The money is then real but the pact is EXPIRED, so nothing would ever
 * settle it. We refund exactly that capture, with a deterministic PayPal-Request-Id
 * so a retry can never refund twice, and record the outcome in the audit feed.
 * A refund that fails is flagged NEEDS_REVIEW instead of being lost.
 */
import type { EventSink } from './events.ts'
import type { PaypalClient } from './paypal.ts'

export type LateCaptureOutcome = 'refunded' | 'needs_review' | 'not_applicable'

export async function refundLateCapture(
  deps: { paypal: PaypalClient; events: EventSink },
  input: { pactId: string; pactStatus: string; captureId: string; amountCents: number },
): Promise<LateCaptureOutcome> {
  // Only an EXPIRED pact is refunded automatically; any other state needs a human.
  if (input.pactStatus !== 'EXPIRED') return 'not_applicable'
  const base = {
    source: 'API' as const,
    eventId: `late-capture-${input.captureId}`,
    resourceId: input.captureId,
    pactId: input.pactId,
    amountCents: input.amountCents,
    verified: true,
  }
  try {
    const refund = await deps.paypal.refundCapture({
      captureId: input.captureId,
      amountCents: input.amountCents,
      requestId: `bloom-refund-late-${input.captureId}`,
    })
    const done = refund.status === 'COMPLETED' || refund.status === 'PENDING'
    await deps.events.record({
      ...base,
      eventType: 'LATE_CAPTURE.REFUNDED',
      status: done ? refund.status : 'NEEDS_REVIEW',
      detail: { refund_id: refund.id },
    })
    return done ? 'refunded' : 'needs_review'
  } catch (err) {
    console.error('late capture refund failed:', err instanceof Error ? err.message : err)
    await deps.events.record({ ...base, eventType: 'LATE_CAPTURE.REFUND_FAILED', status: 'NEEDS_REVIEW' })
    return 'needs_review'
  }
}
