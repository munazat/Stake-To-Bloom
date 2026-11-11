/**
 * StakeButton.tsx — pay the stake through PayPal sandbox checkout.
 *
 * The flow (blueprint §11.1): the server creates the order from the pact row, the
 * v6 SDK opens checkout, and on approval the SERVER captures and funds the pact.
 * This component never learns an amount it could change and never marks anything
 * paid itself; it just asks the server and then refetches.
 */
import { useEffect, useRef, useState } from 'react'
import { formatUsd } from '@bloomstake/core'
import { ApiError, captureStakeOrder, createStakeOrder } from '../lib/api.ts'
import { paymentsAdapter, paypalClientId } from '../lib/config.ts'
import { prepareCheckout } from '../lib/paypal.ts'

interface Props {
  pactId: string
  stakeCents: number
  /** Called after the server confirmed the pact is funded. */
  onFunded: () => void
}

function describe(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503) return 'Payments are switched off right now. Nothing was charged.'
    return err.body?.message ?? err.message
  }
  return err instanceof Error ? err.message : 'Something went wrong. Nothing was charged.'
}

export default function StakeButton({ pactId, stakeCents, onFunded }: Props) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'paying' | 'confirming' | 'unavailable'>(
    paymentsAdapter === 'mock' ? 'ready' : 'loading',
  )
  const [message, setMessage] = useState<string | null>(null)
  const startRef = useRef<(() => Promise<void>) | null>(null)
  const onFundedRef = useRef(onFunded)
  onFundedRef.current = onFunded

  useEffect(() => {
    if (paymentsAdapter === 'mock') return
    if (paypalClientId === '') {
      setPhase('unavailable')
      setMessage('PayPal is not configured for this build (VITE_PAYPAL_CLIENT_ID is empty).')
      return
    }
    let disposed = false
    prepareCheckout(paypalClientId, {
      createOrder: () => createStakeOrder(pactId),
      onApprove: async (orderId) => {
        setPhase('confirming')
        try {
          await captureStakeOrder(orderId, 'capture')
          onFundedRef.current()
        } catch (err) {
          setMessage(describe(err))
        }
        setPhase('ready')
      },
      onCancel: () => {
        setPhase('ready')
        setMessage('Checkout was closed. Nothing was charged. You can try again.')
      },
      onError: () => {
        setPhase('ready')
        setMessage(
          'Checkout could not open. If a popup was blocked, allow popups for this site (Safari and Firefox may also block third-party cookies) and try again.',
        )
      },
    })
      .then((start) => {
        if (disposed) return
        startRef.current = start
        setPhase('ready')
      })
      .catch((err: unknown) => {
        if (disposed) return
        setPhase('unavailable')
        setMessage(describe(err))
      })
    return () => {
      disposed = true
    }
  }, [pactId])

  async function pay() {
    setMessage(null)
    setPhase('paying')
    try {
      if (paymentsAdapter === 'mock') {
        const orderId = await createStakeOrder(pactId)
        setPhase('confirming')
        await captureStakeOrder(orderId, 'capture')
        onFunded()
        setPhase('ready')
        return
      }
      await startRef.current?.()
      // Leaving 'paying' is the SDK callbacks' job (approve / cancel / error).
    } catch (err) {
      setPhase('ready')
      setMessage(describe(err))
    }
  }

  const busy = phase === 'loading' || phase === 'paying' || phase === 'confirming'
  const label =
    phase === 'loading'
      ? 'Loading PayPal…'
      : phase === 'confirming'
        ? 'Confirming your payment…'
        : phase === 'paying'
          ? 'Waiting for PayPal…'
          : `Stake ${formatUsd(stakeCents)} with PayPal (sandbox)`

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void pay()}
        disabled={busy || phase === 'unavailable'}
        className="rounded-full bg-[#0070ba] px-6 py-2.5 font-semibold text-white shadow-sm hover:bg-[#005ea6] disabled:opacity-60"
      >
        {paymentsAdapter === 'mock' ? `Stake ${formatUsd(stakeCents)} (mock payments, dev only)` : label}
      </button>
      {message && (
        <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {message}
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Sandbox only: pay with a PayPal sandbox buyer account. No real money moves.
      </p>
    </div>
  )
}
