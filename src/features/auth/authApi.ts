import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseClient } from '../../lib/supabase/client'

type AuthResult = { session: Session; user: User }

export type RegistrationInput = {
  username: string
  password: string
  displayName: string
  organizationName: string
}

async function invokeAccountFunction(functionName: 'auth-login' | 'auth-register', body: object): Promise<AuthResult> {
  const client = getSupabaseClient()
  const { data, error } = await client.functions.invoke<AuthResult>(functionName, { body })
  if (error || !data?.session) throw new Error('ACCOUNT_REQUEST_FAILED')

  const { error: sessionError } = await client.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })
  if (sessionError) throw new Error('SESSION_SETUP_FAILED')
  return data
}

export function loginWithUsername(username: string, password: string): Promise<AuthResult> {
  return invokeAccountFunction('auth-login', { username, password })
}

export function registerAccount(input: RegistrationInput): Promise<AuthResult> {
  return invokeAccountFunction('auth-register', input)
}
