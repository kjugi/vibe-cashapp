import { OAuth2Client } from 'google-auth-library'
import type { GoogleProfile } from './store.js'

function googleClientId(): string {
  return (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim()
}

function googleClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET?.trim() ?? ''
}

export function googleConfigured(): boolean {
  return Boolean(googleClientId() && googleClientSecret())
}

export async function googleUserFromCode(code: string, redirectUri: string): Promise<GoogleProfile> {
  const clientId = googleClientId()
  const clientSecret = googleClientSecret()
  if (!clientId || !clientSecret) {
    throw new Error('Google sign-in is not configured on the server.')
  }
  const client = new OAuth2Client(clientId, clientSecret, redirectUri)
  const { tokens } = await client.getToken(code)
  if (!tokens.id_token) throw new Error('Google did not return an ID token.')
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId })
  const payload = ticket.getPayload()
  if (!payload?.sub) throw new Error('Google token was missing a user id.')
  return {
    sub: payload.sub,
    email: payload.email ?? null,
    name: payload.name ?? payload.email ?? 'Google user',
  }
}
