type DropboxErrorBody = {
  error_summary?: string
  error?: { '.tag'?: string; path?: { '.tag'?: string } }
}

export function isDropboxPathNotFound(status: number, body: string): boolean {
  if (status !== 409) return false
  if (/not_found/i.test(body)) return true
  try {
    const parsed = JSON.parse(body) as DropboxErrorBody
    return (
      parsed.error?.['.tag'] === 'path' ||
      parsed.error?.path?.['.tag'] === 'not_found' ||
      /not_found/i.test(parsed.error_summary ?? '')
    )
  } catch {
    return false
  }
}
