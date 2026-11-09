/**
 * session.ts — guests get a real anonymous session, not a fake local one.
 *
 * There is no sign-up wall: a judge clicks "Try Demo" and is playing. An
 * anonymous Supabase user still has a real user id, so RLS, the ledger and the
 * eventual payout recipient behave exactly as they will for a signed-in account
 * (blueprint §5). supabase-js persists the session, so a refresh keeps the same
 * garden instead of orphaning it.
 */
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase.ts'

export class NotConfiguredError extends Error {
  constructor() {
    super(
      'Supabase is not configured. Copy .env.example to .env and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    )
    this.name = 'NotConfiguredError'
  }
}

export async function ensureSession(): Promise<Session> {
  if (!supabase) throw new NotConfiguredError()

  const { data } = await supabase.auth.getSession()
  if (data.session) {
    // getSession() reads local storage and never contacts the server, so a token
    // whose user is gone — database reset, revoked session, rotated JWT secret —
    // still looks valid here. getUser() is the call that actually checks. Without
    // it the dead token is handed to every request, each one fails with 401, and
    // the browser can never recover on its own.
    const { error } = await supabase.auth.getUser()
    if (!error) return data.session
    // 'local' because the server-side token is already gone: a global sign-out
    // would be a revocation request that cannot succeed.
    await supabase.auth.signOut({ scope: 'local' })
  }

  const { data: signedIn, error } = await supabase.auth.signInAnonymously()
  if (error || !signedIn.session) {
    throw new Error(error?.message ?? 'Could not start a guest session.')
  }
  return signedIn.session
}
