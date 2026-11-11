/**
 * flow.ts — the webhook path. Reconciliation, never the only trigger.
 *
 * Rules (blueprint §11.2):
 *   - Nothing happens without a PayPal signature that PayPal itself verifies.
 *   - A replayed event id is a 200 no-op.
 *   - 200 is returned only after the work AND the audit row are written. The
 *     audit row is written LAST: if processing fails the event id stays unseen,
 *     so PayPal's retry runs it again instead of being swallowed as a "replay".
 *   - Handlers are idempotent and order-independent: they look the pact up
 *     themselves and never assume an earlier event arrived.
 *
 * Phase 8 owns the payout/refund event types; for now they are verified and
 * shown on the audit feed, and change no state.
 */
import { usdStringToCents } from '../_shared/core/index.ts'
import { HttpError, json } from '../_shared/http.ts'
import type { EventSink } from '../_shared/events.ts'
import {
  fundPact,
  validateCapture,
  type FundingDb,
  type PayeeExpectation,
} from '../_shared/funding.ts'
import type { PaypalClient } from '../_shared/paypal.ts'

export const MAX_WEBHOOK_BYTES = 100 * 1024

export interface WebhookPact {
  id: string
  user_id: string
  status: string
  stake_cents: number | string
  currency: string
  tz: string
  paypal_order_id: string | null
}

export interface WebhookDeps {
  paypal: PaypalClient
  events: EventSink
  funding: FundingDb
  payee: PayeeExpectation
  webhookId: string
  now(): Date
  loadPactByOrder(orderId: string): Promise<WebhookPact | null>
  loadPactByCapture(captureId: string): Promise<WebhookPact | null>
  /** ACTIVE -> NEEDS_REVIEW. 'skipped' when the pact is not in a state that allows it. */
  flagForReview(pactId: string): Promise<'moved' | 'skipped'>
  reconcileSettlement?(eventType: string, resource: Record<string, unknown>): Promise<string | null>
}

async function readBoundedBody(request: Request): Promise<string> {
  const reader = request.body?.getReader()
  if (!reader) return ''

  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_WEBHOOK_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new HttpError(413, 'body_too_large', 'Webhook body is too large.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new HttpError(400, 'invalid_encoding', 'Webhook body must be UTF-8 JSON.')
  }
}

interface Resource {
  id?: unknown
  status?: unknown
  amount?: { value?: unknown }
  supplementary_data?: { related_ids?: { order_id?: unknown } }
  payout_batch_id?: unknown
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

function amountCents(resource: Resource): number | null {
  const value = str(resource.amount?.value)
  if (!value) return null
  try {
    return usdStringToCents(value)
  } catch {
    return null
  }
}

export async function handleWebhook(deps: WebhookDeps, request: Request): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
    throw new HttpError(413, 'body_too_large', 'Webhook body is too large.')
  }
  const raw = await readBoundedBody(request)

  let event: { id?: unknown; event_type?: unknown; resource?: unknown }
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not an object')
    event = parsed
  } catch {
    throw new HttpError(400, 'invalid_json', 'Webhook body must be a JSON object.')
  }

  // Signature first. Anything that is not an unambiguous SUCCESS is a 400.
  let verified = false
  try {
    verified = await deps.paypal.verifyWebhook({
      headers: request.headers,
      webhookId: deps.webhookId,
      rawEventBody: raw,
    })
  } catch (err) {
    // A verification outage is NOT a rejection: ask PayPal to retry later.
    console.error('webhook: signature verification unavailable:', (err as Error).message)
    throw new HttpError(
      503,
      'verification_unavailable',
      'Could not verify the signature right now.',
    )
  }
  if (!verified) {
    console.error('webhook: rejected an unverified body')
    throw new HttpError(400, 'bad_signature', 'Webhook signature verification failed.')
  }

  const eventId = str(event.id)
  const eventType = str(event.event_type)
  if (!eventId || !eventType)
    throw new HttpError(400, 'invalid_event', 'Webhook event has no id or type.')

  if (await deps.events.seen(eventId)) return json({ ok: true, replay: true })

  const resource = (event.resource ?? {}) as Resource
  const resourceId = str(resource.id)
  const orderId = str(resource.supplementary_data?.related_ids?.order_id)
  let pactId: string | null = null
  let status = str(resource.status) ?? eventType.split('.').pop() ?? null
  const detail: Record<string, string | number | boolean | null> = {}

  switch (eventType) {
    case 'PAYMENT.CAPTURE.COMPLETED': {
      const pact = orderId ? await deps.loadPactByOrder(orderId) : null
      pactId = pact?.id ?? null
      if (!pact || !orderId) {
        detail.note = 'no matching pact'
        break
      }
      // The capture resource carries no payer; the order does, and re-checking the
      // order means the webhook funds by exactly the same rules as the API path.
      const order = await deps.paypal.getOrder(orderId)
      const check = validateCapture(pact, order, deps.payee)
      if (check.kind === 'ok') {
        const result = await fundPact(deps.funding, pact, check.capture, deps.now())
        detail.funded = result.funded
        if (!result.funded) detail.note = `pact is ${result.status}`
      } else if (check.kind === 'mismatch') {
        status = 'REJECTED'
        detail.reason = check.reason
        console.error('webhook: capture rejected:', check.reason)
      } else {
        detail.note = `still ${check.status}`
      }
      break
    }

    case 'PAYMENT.CAPTURE.DENIED':
    case 'PAYMENT.CAPTURE.REVERSED': {
      const pact =
        (orderId ? await deps.loadPactByOrder(orderId) : null) ??
        (resourceId ? await deps.loadPactByCapture(resourceId) : null)
      pactId = pact?.id ?? null
      if (pact) detail.review = (await deps.flagForReview(pact.id)) === 'moved'
      break
    }

    case 'PAYMENT.PAYOUTSBATCH.SUCCESS':
    case 'PAYMENT.PAYOUTSBATCH.DENIED':
    case 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED':
    case 'PAYMENT.PAYOUTS-ITEM.DENIED':
    case 'PAYMENT.PAYOUTS-ITEM.UNCLAIMED':
    case 'PAYMENT.PAYOUTS-ITEM.RETURNED':
    case 'PAYMENT.PAYOUTS-ITEM.FAILED': {
      pactId = deps.reconcileSettlement
        ? await deps.reconcileSettlement(eventType, resource as Record<string, unknown>)
        : null
      detail.settlement = pactId ? 'updated' : 'not found'
      break
    }

    default: {
      // Refund / payout events are Phase 8; recorded and visible, no state change.
      if (orderId) pactId = (await deps.loadPactByOrder(orderId))?.id ?? null
      if (!pactId && resourceId) pactId = (await deps.loadPactByCapture(resourceId))?.id ?? null
    }
  }

  await deps.events.record({
    source: 'WEBHOOK',
    eventId,
    eventType,
    resourceId,
    pactId,
    status,
    amountCents: amountCents(resource),
    verified: true,
    detail,
  })
  return json({ ok: true })
}
