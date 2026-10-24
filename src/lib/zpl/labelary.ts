import { AsyncQueuer } from '@tanstack/react-pacer'

import type { PrintDensity } from './render'

const API_URL = 'https://api.labelary.com/v1/printers'
const MM_PER_INCH = 25.4
/** Labelary's free tier allows 3 requests a second from each client. */
const REQUEST_SPACING_MS = 350

export interface LabelarySize {
  /** In dots. */
  width: number
  height: number
  printDensity: PrintDensity
}

export interface LabelaryLabel {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

export interface LabelaryResult {
  labels: LabelaryLabel[]
  /** How many labels Labelary found in the ZPL, fetched or not. */
  total: number
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

/**
 * Renders the first `sizes.length` labels of `source` with Labelary, each at
 * the matching size so it lines up dot for dot with the local render.
 */
export async function renderWithLabelary(
  source: string,
  sizes: readonly LabelarySize[],
  signal?: AbortSignal,
): Promise<LabelaryResult> {
  if (sizes.length === 0) return { labels: [], total: 0 }

  const first = await fetchLabel(source, sizes[0], 0, signal)
  const labels = [first.label]
  const count = Math.min(first.total, sizes.length)
  for (let index = 1; index < count; index++) {
    labels.push((await fetchLabel(source, sizes[index], index, signal)).label)
  }
  return { labels, total: first.total }
}

function fetchLabel(
  source: string,
  size: LabelarySize,
  index: number,
  signal?: AbortSignal,
) {
  return enqueue(async () => {
    signal?.throwIfAborted()

    const body = new FormData()
    body.append('file', new Blob([source]), 'label.zpl')
    const response = await fetch(labelUrl(size, index), {
      method: 'POST',
      headers: { Accept: 'image/png' },
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

    const total = Number(response.headers.get('X-Total-Count') ?? 1)
    const bitmap = await createImageBitmap(await response.blob())
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    bitmap.close()

    return {
      label: { canvas, width: canvas.width, height: canvas.height },
      total: Number.isFinite(total) && total > 0 ? total : 1,
    }
  })
}

function labelUrl(size: LabelarySize, index: number) {
  // Labelary converts at dpmm × 25.4 dpi with the fraction dropped (152, 203,
  // 304, 609), not the nominal 300 / 600, then rounds the dots down. Aim half
  // a dot past the size we want: 812 dots at 203 dpi is sent as 4.0025 in.
  const dpi = Math.floor(size.printDensity * MM_PER_INCH)
  const inches = (dots: number) => ((dots + 0.5) / dpi).toFixed(4)
  return `${API_URL}/${size.printDensity}dpmm/labels/${inches(size.width)}x${inches(size.height)}/${index}/`
}
