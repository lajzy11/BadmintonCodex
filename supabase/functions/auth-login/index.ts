import { withSupabase } from 'npm:@supabase/server'
import { AccountInputError, internalEmailFor, normalizeUsername, requirePassword } from '../_shared/account.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const login = withSupabase({ auth: 'publishable' }, async (request, context) => {
  if (request.method !== 'POST') return jsonResponse({ code: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const body = await request.json()
    const username = normalizeUsername(body.username)
    const password = requirePassword(body.password)
    const email = await internalEmailFor(username)
    const { data, error } = await context.supabase.auth.signInWithPassword({ email, password })

    if (error || !data.session) return jsonResponse({ code: 'INVALID_CREDENTIALS' }, 401)
    return jsonResponse({ session: data.session, user: data.user })
  } catch (error) {
    if (error instanceof AccountInputError) return jsonResponse({ code: 'INVALID_CREDENTIALS' }, 401)
    console.error('auth-login failed', error instanceof Error ? error.message : 'unknown')
    return jsonResponse({ code: 'LOGIN_FAILED' }, 500)
  }
})

export default {
  fetch(request: Request): Promise<Response> | Response {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    return login(request)
  },
}
