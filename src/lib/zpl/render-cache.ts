const CACHE_NAME = 'labelary-renders'
/** Renders kept across reloads, each one job's PDF. */
const MAX_CACHED_RENDERS = 500

/**
 * Successful renders are kept in Cache Storage so a reload, or going back to
 * an earlier version of a label, costs no request against the rate limit.
 * Unavailable outside secure contexts, where every render is fetched.
 */
async function openCache() {
  if (typeof caches === 'undefined') return undefined
  return caches.open(CACHE_NAME).catch(() => undefined)
}

/** The render's URL with a hash of the ZPL, since Cache Storage keys on GETs. */
export async function cacheKey(url: string, source: string) {
  if (typeof crypto === 'undefined' || !('subtle' in crypto)) return undefined
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(source),
  )
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return `${url}?zpl=${hash}`
}

export async function readCached(key: string) {
  const cache = await openCache()
  return (await cache?.match(key).catch(() => undefined)) ?? undefined
}

export async function writeCached(key: string, response: Response) {
  const cache = await openCache()
  if (!cache) return
  try {
    // Copied into a plain response so the headers we read stay readable.
    const headers = new Headers({ 'Content-Type': 'application/pdf' })
    for (const name of ['X-Total-Count', 'X-Warnings']) {
      const value = response.headers.get(name)
      if (value !== null) headers.set(name, value)
    }
    await cache.put(key, new Response(await response.blob(), { headers }))

    // Keys come back oldest first, so drop from the front.
    const keys = await cache.keys()
    const excess = Math.max(0, keys.length - MAX_CACHED_RENDERS)
    for (const request of keys.slice(0, excess)) {
      await cache.delete(request)
    }
  } catch {
    // A full or unavailable cache only means the next render is fetched.
  }
}
