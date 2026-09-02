import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { appConfig } from '../config'
import { isDemoMode } from '../guestMode'
import { getGuestSupabaseClient } from './guestClient'

let client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (isDemoMode()) return getGuestSupabaseClient()
  if (!appConfig.isSupabaseConfigured) {
    throw new Error('SUPABASE_NOT_CONFIGURED')
  }

  client ??= createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  })

  return client
}
