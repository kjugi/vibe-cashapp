function allowedOrigins(): string[] {
  const extra = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const vercel = process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []
  return [...new Set([...extra, ...vercel])]
}

function originAllowed(origin: string, request: Request): boolean {
  if (allowedOrigins().includes(origin)) return true
  try {
    const host = request.headers.get('host')
    return Boolean(host) && new URL(origin).host === host
  } catch {
    return false
  }
}

export function corsHeaders(request: Request): Headers {
  const headers = new Headers()
  const origin = request.headers.get('origin')
  if (origin && originAllowed(origin, request)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Vary', 'Origin')
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Backup-Hash, X-Backup-Empty')
  headers.set('Access-Control-Max-Age', '86400')
  return headers
}

export function json(request: Request, body: unknown, status = 200): Response {
  const headers = corsHeaders(request)
  headers.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(body), { status, headers })
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

export function applyCors(request: Request, headers: Headers): Headers {
  corsHeaders(request).forEach((value, key) => {
    if (!headers.has(key)) headers.set(key, value)
  })
  return headers
}

export function bearerToken(request: Request): string {
  const auth = request.headers.get('authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
}

function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  const max = Math.max(left.byteLength, right.byteLength, 1)
  let diff = left.byteLength ^ right.byteLength
  for (let i = 0; i < max; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  return diff === 0
}

export function requireCron(request: Request): Response | null {
  const secret = process.env.CRON_SECRET?.trim()
  if (secret) {
    if (!safeEqual(bearerToken(request), secret)) return json(request, { error: 'Unauthorized' }, 401)
    return null
  }
  if (process.env.VERCEL && request.headers.get('user-agent') !== 'vercel-cron/1.0') {
    return json(request, { error: 'Unauthorized' }, 401)
  }
  return null
}
