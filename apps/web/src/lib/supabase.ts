import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from './config.ts'

/**
 * Null until the project is configured, so the app renders without Supabase.
 * Import from ./config.ts instead if you only need the URL, the anon key or the
 * configured flag — importing this module loads the SDK.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null
