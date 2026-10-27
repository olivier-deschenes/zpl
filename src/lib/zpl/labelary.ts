import { AsyncQueuer } from '@tanstack/react-pacer'

import { labelDots } from './settings'
import type { LabelSettings, PrintDensity } from './settings'

const API_URL = 'https://api.labelary.com/v1/printers'
const MM_PER_INCH = 25.4
/** Labelary's free tier allows 3 requests a second from each client. */
const REQUEST_SPACING_MS = 350
/** Each label is its own request, so long jobs are cut short. */
export const MAX_LABELS = 50
const CACHE_NAME = 'labelary-renders'
/** Renders kept across reloads, each one label's PNG. */
const MAX_CACHED_RENDERS = 500

export interface LabelaryLabel {
  canvas: HTMLCanvasElement
  /** In dots. */
  width: number
  height: number
  printDensity: PrintDensity
}

/** A problem Labelary's linter found, located in the source as sent. */
export interface LabelaryWarning {
  /** UTF-16 offsets into the source, like editor positions. */
  from: number
  to: number
  command: string
  message: string
}

export interface LabelaryResult {
  labels: LabelaryLabel[]
  /** How many labels Labelary found in the ZPL, fetched or not. */
  total: number
  warnings: LabelaryWarning[]
}

export class LabelaryError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Seconds to wait before retrying, sent with 429 responses. */
    readonly retryAfter?: number,
  ) {
    super(message)
    this.name = 'LabelaryError'
  }
}

// One queue for every panel: the rate limit is per client, not per label.
const queue = new AsyncQueuer<() => Promise<void>>((task) => task(), {
  concurrency: 1,
  wait: REQUEST_SPACING_MS,
})

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.addItem(() => task().then(resolve, reject))
  })
}

/** Renders up to `MAX_LABELS` labels of `source` at the settings' size. */
export async function renderWithLabelary(
  source: string,
  settings: LabelSettings,
  signal?: AbortSignal,
): Promise<LabelaryResult> {
  if (!source.trim()) return { labels: [], total: 0, warnings: [] }

  const first = await fetchLabel(source, settings, 0, signal)
  const responses = [first]
  const count = Math.min(first.total, MAX_LABELS)
  for (let index = 1; index < count; index++) {
    responses.push(await fetchLabel(source, settings, index, signal))
  }

  const warnings = new Map<string, LabelaryWarning>()
  for (const response of responses) {
    for (const warning of parseWarnings(source, response.warnings)) {
      warnings.set(`${warning.from}:${warning.to}:${warning.message}`, warning)
    }
  }

  return {
    labels: responses.map((response) => response.label),
    total: first.total,
    warnings: [...warnings.values()],
  }
}

async function fetchLabel(
  source: string,
  settings: LabelSettings,
  index: number,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const url = labelUrl(settings, index)
  const key = await cacheKey(url, source)
  const response =
    (key ? await readCached(key) : undefined) ??
    (await enqueue(() => requestLabel(url, source, key, signal)))
  signal?.throwIfAborted()

  const total = Number(response.headers.get('X-Total-Count') ?? 1)
  const bitmap = await createImageBitmap(await response.blob())
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()

  return {
    label: {
      canvas,
      width: canvas.width,
      height: canvas.height,
      printDensity: settings.dpmm,
    },
    total: Number.isFinite(total) && total > 0 ? total : 1,
    warnings: response.headers.get('X-Warnings') ?? '',
  }
}

async function requestLabel(
  url: string,
  source: string,
  key: string | undefined,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()

  const body = new FormData()
  body.append('file', new Blob([source]), 'label.zpl')
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'image/png', 'X-Linter': 'On' },
    body,
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const retryAfter = Number(response.headers.get('Retry-After'))
    throw new LabelaryError(
      text.replace(/^ERROR:\s*/, '').trim() || `HTTP ${response.status}`,
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    )
  }

  if (key) void writeCached(key, response.clone())
  return response
}

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
async function cacheKey(url: string, source: string) {
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

async function readCached(key: string) {
  const cache = await openCache()
  return (await cache?.match(key).catch(() => undefined)) ?? undefined
}

async function writeCached(key: string, response: Response) {
  const cache = await openCache()
  if (!cache) return
  try {
    // Copied into a plain response so the headers we read stay readable.
    const headers = new Headers({ 'Content-Type': 'image/png' })
    for (const name of ['X-Total-Count', 'X-Warnings']) {
      const value = response.headers.get(name)
      if (value !== null) headers.set(name, value)
    }
    await cache.put(key, new Response(await response.blob(), { headers }))

    // Keys come back oldest first, so drop from the front.
    const keys = await cache.keys()
    for (const request of keys.slice(0, keys.length - MAX_CACHED_RENDERS)) {
      await cache.delete(request)
    }
  } catch {
    // A full or unavailable cache only means the next render is fetched.
  }
}

function labelUrl(settings: LabelSettings, index: number) {
  // Labelary converts at dpmm × 25.4 dpi with the fraction dropped (152, 203,
  // 304, 609), not the nominal 300 / 600, then rounds the dots down. Aim half
  // a dot past the size we want: 812 dots at 203 dpi is sent as 4.0025 in.
  const { width, height } = labelDots(settings)
  const dpi = Math.floor(settings.dpmm * MM_PER_INCH)
  const inches = (dots: number) => ((dots + 0.5) / dpi).toFixed(4)
  return `${API_URL}/${settings.dpmm}dpmm/labels/${inches(width)}x${inches(height)}/${index}/`
}

/**
 * Reads Labelary's `X-Warnings` header: groups of byte offset, byte length,
 * command, parameter number and message, all joined by `|`.
 */
export function parseWarnings(
  source: string,
  header: string,
): LabelaryWarning[] {
  if (!header) return []
  const fields = header.split('|')
  const toIndex = byteToIndex(source)
  const warnings: LabelaryWarning[] = []
  for (let at = 0; at + 4 < fields.length; at += 5) {
    const offset = Number(fields[at])
    const length = Number(fields[at + 1])
    const message = fields[at + 4].trim()
    if (!Number.isFinite(offset) || !Number.isFinite(length) || !message) {
      continue
    }
    warnings.push({
      from: toIndex(offset),
      to: toIndex(offset + Math.max(length, 0)),
      command: fields[at + 2],
      message,
    })
  }
  return warnings
}

/** Maps UTF-8 byte offsets, which Labelary reports, to string indices. */
function byteToIndex(source: string) {
  return (byteOffset: number) => {
    let bytes = 0
    let index = 0
    while (index < source.length && bytes < byteOffset) {
      const codePoint = source.codePointAt(index) ?? 0
      bytes +=
        codePoint < 0x80
          ? 1
          : codePoint < 0x800
            ? 2
            : codePoint < 0x10000
              ? 3
              : 4
      index += codePoint > 0xffff ? 2 : 1
    }
    return index
  }
}
