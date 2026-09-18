import { handleSession } from './_lib/handlers.js'

export function OPTIONS(request: Request) {
  return handleSession(request)
}

export function GET(request: Request) {
  return handleSession(request)
}

export function POST(request: Request) {
  return handleSession(request)
}
