import { handleBackup } from './_lib/handlers'

export function OPTIONS(request: Request) {
  return handleBackup(request)
}

export function GET(request: Request) {
  return handleBackup(request)
}

export function POST(request: Request) {
  return handleBackup(request)
}
