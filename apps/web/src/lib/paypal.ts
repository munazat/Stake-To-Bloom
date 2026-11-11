/**
 * paypal.ts — the PayPal JS SDK v6 (sandbox), loaded on demand.
 *
 * v5 is deprecated; v6 is a core script plus `createInstance`. The browser only
 * ever holds the public Client ID. The order is created and captured by our
 * server, so nothing here can choose an amount or a recipient (invariant I2).
 */

const SDK_URL = 'https://www.sandbox.paypal.com/web-sdk/v6/core'

interface PayPalSession {
  start(options: { presentationMode: 'auto' | 'popup' | 'modal' | 'redirect' }, order: Promise<{ orderId: string }>): Promise<void>
}

interface PayPalSdkInstance {
  createPayPalOneTimePaymentSession(callbacks: {
    onApprove: (data: { orderId: string }) => void | Promise<void>
    onCancel?: () => void
    onError?: (error: unknown) => void
  }): PayPalSession
}

interface PayPalGlobal {
  createInstance(options: { clientId: string; components: string[]; pageType: string }): Promise<PayPalSdkInstance>
}

declare global {
  interface Window {
    paypal?: PayPalGlobal
  }
}

let sdkLoad: Promise<PayPalGlobal> | null = null

/** Inject the SDK script once. Rejects (and allows a retry) if the script cannot load. */
export function loadPayPalSdk(): Promise<PayPalGlobal> {
  if (window.paypal) return Promise.resolve(window.paypal)
  if (sdkLoad) return sdkLoad
  sdkLoad = new Promise<PayPalGlobal>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error('The PayPal SDK loaded but is unavailable.')))
    script.onerror = () => {
      sdkLoad = null
      script.remove()
      reject(new Error('Could not load PayPal. A content blocker or network filter may be stopping it.'))
    }
    document.head.appendChild(script)
  })
  return sdkLoad
}

export interface CheckoutHandlers {
  /** Resolves to the order id the SERVER created. */
  createOrder: () => Promise<string>
  /** Called after the buyer approved; the server captures. */
  onApprove: (orderId: string) => Promise<void>
  onCancel: () => void
  onError: (error: unknown) => void
}

/**
 * Prepare a checkout and return the function to call from a click handler. The
 * SDK is initialised ahead of the click so the popup opens inside the user
 * gesture; opening it after an `await` is what browsers block.
 */
export async function prepareCheckout(clientId: string, handlers: CheckoutHandlers): Promise<() => Promise<void>> {
  const paypal = await loadPayPalSdk()
  const sdk = await paypal.createInstance({ clientId, components: ['paypal-payments'], pageType: 'checkout' })
  const session = sdk.createPayPalOneTimePaymentSession({
    onApprove: async ({ orderId }) => handlers.onApprove(orderId),
    onCancel: handlers.onCancel,
    onError: handlers.onError,
  })
  return () =>
    session.start(
      { presentationMode: 'auto' },
      handlers.createOrder().then((orderId) => ({ orderId })),
    )
}
