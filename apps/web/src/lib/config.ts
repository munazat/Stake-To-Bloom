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
