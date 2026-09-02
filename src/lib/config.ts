const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

export const appConfig = {
  supabaseUrl,
  supabasePublishableKey,
  isSupabaseConfigured: Boolean(supabaseUrl && supabasePublishableKey),
  isDemo: import.meta.env.MODE === 'test' || import.meta.env.VITE_APP_MODE !== 'connected' || !supabaseUrl || !supabasePublishableKey,
} as const
