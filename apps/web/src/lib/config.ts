/**
 * config.ts — the build-time environment, with no dependencies.
 *
 * Deliberately separate from supabase.ts: reading `import.meta.env` costs
 * nothing, whereas creating a client pulls in the whole Supabase SDK including
 * its realtime WebSocket stack. The landing page only needs to know whether the
 * project is configured, and must not pay for the SDK to find out.
 */

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/**
 * False until VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are provided, so the
 * app still renders (and tests still pass) without a Supabase project.
 */
export const isSupabaseConfigured = supabaseUrl !== '' && supabaseAnonKey !== ''

/** Absolute URL of an Edge Function, e.g. edgeFunctionUrl('pact-create'). */
export function edgeFunctionUrl(name: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/${name}`
}

/** The PayPal sandbox REST app's Client ID. Public by design; the secret never reaches the browser. */
export const paypalClientId = import.meta.env.VITE_PAYPAL_CLIENT_ID ?? ''

/**
 * "mock" swaps PayPal for a local stand-in (decision D12). It exists so the stake
 * flow can be developed without sandbox credentials, and it must never ship:
 * a production build that asks for it refuses to load.
 */
export const paymentsAdapter: 'paypal' | 'mock' =
  import.meta.env.VITE_PAYMENTS_ADAPTER === 'mock' ? 'mock' : 'paypal'

if (import.meta.env.PROD && paymentsAdapter === 'mock') {
  throw new Error('VITE_PAYMENTS_ADAPTER=mock is for local development only and cannot be used in a production build.')
}
