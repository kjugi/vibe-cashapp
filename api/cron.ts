import { handleCron } from './_lib/handlers.js'

export function OPTIONS(request: Request) {
  return handleCron(request)
}

export function GET(request: Request) {
  return handleCron(request)
}

export function POST(request: Request) {
  return handleCron(request)
}
