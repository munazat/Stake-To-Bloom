import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareCheckout } from '../src/lib/paypal.ts'

interface SessionCallbacks {
  onApprove: (data: { orderId: string }) => void | Promise<void>
  onCancel?: () => void
  onError?: (error: unknown) => void
}

describe('PayPal JavaScript SDK v6', () => {
  afterEach(() => {
    delete window.paypal
    vi.restoreAllMocks()
  })

  it('loads the sandbox SDK, creates a server-order session, and forwards approval', async () => {
    const createOrder = vi.fn().mockResolvedValue('ORDER-123')
    const onApprove = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn()
    const onError = vi.fn()
    const callbacks: { current: SessionCallbacks | null } = { current: null }
    let startedOrder: { orderId: string } | null = null
    const start = vi.fn(async (_options: unknown, order: Promise<{ orderId: string }>) => {
      startedOrder = await order
    })

    const sdkInstance = {
      createPayPalOneTimePaymentSession: (next: SessionCallbacks) => {
        callbacks.current = next
        return { start }
      },
    }
    const createInstance = vi.fn().mockResolvedValue(sdkInstance)
    const sdkGlobal = { createInstance } as unknown as NonNullable<Window['paypal']>
    const appendChild = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const script = node as HTMLScriptElement
      expect(script.src).toBe('https://www.sandbox.paypal.com/web-sdk/v6/core')
      window.paypal = sdkGlobal
      script.dispatchEvent(new Event('load'))
      return node
    })

    const checkout = await prepareCheckout('PUBLIC-CLIENT-ID', {
      createOrder,
      onApprove,
      onCancel,
      onError,
    })

    expect(appendChild).toHaveBeenCalledTimes(1)
    expect(createInstance).toHaveBeenCalledWith({
      clientId: 'PUBLIC-CLIENT-ID',
      components: ['paypal-payments'],
      pageType: 'checkout',
    })

    await checkout()
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith({ presentationMode: 'auto' }, expect.any(Promise))
    expect(startedOrder).toEqual({ orderId: 'ORDER-123' })

    await callbacks.current?.onApprove({ orderId: 'ORDER-123' })
    callbacks.current?.onCancel?.()
    callbacks.current?.onError?.(new Error('checkout error'))
    expect(onApprove).toHaveBeenCalledWith('ORDER-123')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
