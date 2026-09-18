import { SignJWT, jwtVerify } from 'jose'
import { bearerToken, json } from './http.js'
import { ensureUser, loadState, type CloudState, type GoogleProfile } from './store.js'

const SESSION_DAYS = '90d'

function sessionSecret(): Uint8Array {
  const raw = process.env.SESSION_SECRET?.trim() || process.env.VAPID_PRIVATE_KEY?.trim()
  if (!raw) throw new Error('Set SESSION_SECRET (or VAPID_PRIVATE_KEY) to sign login sessions.')
  return new TextEncoder().encode(raw)
}

export async function signSession(profile: GoogleProfile): Promise<string> {
  return new SignJWT({ email: profile.email, name: profile.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(profile.sub)
    .setIssuedAt()
    .setExpirationTime(SESSION_DAYS)
    .sign(sessionSecret())
}

export async function readSession(token: string): Promise<GoogleProfile | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret())
    if (typeof payload.sub !== 'string' || !payload.sub) return null
    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      name: typeof payload.name === 'string' ? payload.name : 'Google user',
    }
  } catch {
    return null
  }
}

export type AuthedUser = {
  userId: string
  email: string | null
  displayName: string
  state: CloudState
}

export async function requireUser(request: Request): Promise<AuthedUser | Response> {
  const token = bearerToken(request)
  if (!token) return json(request, { error: 'Sign in with Google first.' }, 401)
  let profile: GoogleProfile
  try {
    const parsed = await readSession(token)
    if (!parsed) return json(request, { error: 'Session expired. Sign in with Google again.' }, 401)
    profile = parsed
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Session expired. Sign in with Google again.'
    return json(request, { error: message }, 401)
  }
  const state = (await loadState(profile.sub)) ?? (await ensureUser(profile))
  return {
    userId: profile.sub,
    email: state.email ?? profile.email,
    displayName: state.displayName ?? profile.name,
    state,
  }
}
