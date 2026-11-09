import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Null until VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are provided, so the
 * scaffold runs and tests pass before a Supabase project exists (Phase 3).
 */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null

export const isSupabaseConfigured = Boolean(url && anonKey)
