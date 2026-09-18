import { handlePush } from './_lib/handlers.js'

export function OPTIONS(request: Request) {
  return handlePush(request)
}

export function GET(request: Request) {
  return handlePush(request)
}

export function POST(request: Request) {
  return handlePush(request)
}

export function DELETE(request: Request) {
  return handlePush(request)
}
