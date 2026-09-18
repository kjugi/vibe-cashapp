import { handleBackup } from './_lib/handlers.js'

export function OPTIONS(request: Request) {
  return handleBackup(request)
}

export function GET(request: Request) {
  return handleBackup(request)
}

export function POST(request: Request) {
  return handleBackup(request)
}
