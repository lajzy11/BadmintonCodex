const usernamePattern = /^[a-z0-9_]{4,20}$/

export function normalizeUsername(value: unknown): string {
  if (typeof value !== 'string') throw new AccountInputError('INVALID_USERNAME')
  const normalized = value.trim().toLowerCase()
  if (!usernamePattern.test(normalized) || !/[a-z0-9]/.test(normalized)) {
    throw new AccountInputError('INVALID_USERNAME')
  }
  return normalized
}

export function requireText(value: unknown, code: string, maxLength = 80): string {
  if (typeof value !== 'string') throw new AccountInputError(code)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) throw new AccountInputError(code)
  return normalized
}

export function requirePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 64 || !/[a-z]/i.test(value) || !/[0-9]/.test(value)) {
    throw new AccountInputError('INVALID_PASSWORD')
  }
  return value
}

export async function internalEmailFor(username: string): Promise<string> {
  const pepper = Deno.env.get('USERNAME_PEPPER')
  if (!pepper) throw new Error('USERNAME_PEPPER_NOT_CONFIGURED')

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username))
  const digest = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${digest}@auth.local.invalid`
}

export class AccountInputError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}
