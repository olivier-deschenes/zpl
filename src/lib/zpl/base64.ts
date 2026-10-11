const DATA_URI_PREFIX = /^data:[^,]*;base64,/i
const BASE64_ALPHABET = /^[A-Za-z0-9+/_-]+={0,2}$/
const ZPL_COMMAND = /[\^~][A-Za-z][A-Za-z0-9@]/g
const MIN_LENGTH = 8
const MAX_DEPTH = 3

/**
 * Return the decoded ZPL when `text` is base64 (optionally a data URI,
 * URL-safe, line-wrapped or encoded more than once). Anything that is not
 * base64, or decodes to something other than ZPL, returns null.
 */
export function decodeBase64Zpl(text: string): string | null {
  let current = text
  let decoded: string | null = null

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const next = decodeOnce(current)
    if (next === null) break
    decoded = next
    current = next
  }

  return decoded !== null && looksLikeZpl(decoded) ? decoded : null
}

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeOnce(text: string): string | null {
  const compact = text.trim().replace(DATA_URI_PREFIX, '').replace(/\s+/g, '')
  if (compact.length < MIN_LENGTH || !BASE64_ALPHABET.test(compact)) return null

  const standard = compact
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/=+$/, '')
  if (standard.length % 4 === 1) return null
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=')

  let binary: string
  try {
    binary = atob(padded)
  } catch {
    return null
  }

  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // ZPL defaults to a single-byte code page (^CI0), so fall back to latin1.
    return binary
  }
}

function looksLikeZpl(text: string): boolean {
  if (/\^XA/i.test(text)) return true
  return (text.match(ZPL_COMMAND)?.length ?? 0) >= 2
}
