import { withSupabase } from 'npm:@supabase/server'
import { AccountInputError, internalEmailFor, normalizeUsername, requirePassword, requireText } from '../_shared/account.ts'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const register = withSupabase({ auth: 'publishable' }, async (request, context) => {
  if (request.method !== 'POST') return jsonResponse({ code: 'METHOD_NOT_ALLOWED' }, 405)

  let createdUserId: string | undefined
  try {
    const body = await request.json()
    const username = normalizeUsername(body.username)
    const password = requirePassword(body.password)
    const displayName = requireText(body.displayName, 'INVALID_DISPLAY_NAME', 20)
    if (displayName.length < 2 || !/^[\p{Script=Han}A-Za-z0-9]+$/u.test(displayName)) {
      throw new AccountInputError('INVALID_DISPLAY_NAME')
    }
    const organizationName = requireText(body.organizationName, 'INVALID_ORGANIZATION_NAME', 40)
    const email = await internalEmailFor(username)

    const { data: created, error: createError } = await context.supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { login_kind: 'username' },
    })
    if (createError || !created.user) {
      return jsonResponse({ code: 'USERNAME_UNAVAILABLE' }, 409)
    }
    createdUserId = created.user.id

    const { error: onboardingError } = await context.supabaseAdmin.rpc('onboard_account', {
      target_user_id: createdUserId,
      target_username_normalized: username,
      target_display_name: displayName,
      target_organization_name: organizationName,
    })
    if (onboardingError) throw onboardingError

    const { data: session, error: signInError } = await context.supabase.auth.signInWithPassword({ email, password })
    if (signInError) throw signInError

    return jsonResponse({ session: session.session, user: session.user }, 201)
  } catch (error) {
    if (createdUserId) await context.supabaseAdmin.auth.admin.deleteUser(createdUserId)
    if (error instanceof AccountInputError) return jsonResponse({ code: error.code }, 400)
    console.error('auth-register failed', error instanceof Error ? error.message : 'unknown')
    return jsonResponse({ code: 'REGISTRATION_FAILED' }, 500)
  }
})

export default {
  fetch(request: Request): Promise<Response> | Response {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    return register(request)
  },
}
