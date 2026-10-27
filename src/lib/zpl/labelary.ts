import { AsyncQueuer } from '@tanstack/react-pacer'

import type * as Pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

import { cacheKey, readCached, writeCached } from './render-cache'
import { labelDots } from './settings'
import type { LabelSettings, PrintDensity } from './settings'

const API_URL = 'https://api.labelary.com/v1/printers'
const MM_PER_INCH = 25.4
const POINTS_PER_INCH = 72
/** Labelary's free tier allows 3 requests a second from each client. */
const REQUEST_SPACING_MS = 350

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
  /** How many labels Labelary found in the ZPL. */
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

/**
 * Renders every label of `source` at the settings' size. PNGs come back one
 * label per request, so the whole job is fetched as a single PDF and drawn
 * here instead, costing one request against the rate limit however many
 * labels it holds.
 */
export async function renderWithLabelary(
  source: string,
  settings: LabelSettings,
  signal?: AbortSignal,
): Promise<LabelaryResult> {
  if (!source.trim()) return { labels: [], total: 0, warnings: [] }

  const url = labelsUrl(settings)
  const key = await cacheKey(url, source)
  signal?.throwIfAborted()
  const response =
    (key ? await readCached(key) : undefined) ??
    (await enqueue(() => requestLabels(url, source, key, signal)))
  signal?.throwIfAborted()

  const labels = await drawPages(
    await response.arrayBuffer(),
    settings.dpmm,
    signal,
  )
  const total = Number(response.headers.get('X-Total-Count'))
  return {
    labels,
    total: Number.isFinite(total) && total > 0 ? total : labels.length,
    warnings: parseWarnings(source, response.headers.get('X-Warnings') ?? ''),
  }
}

/** Draws each page of Labelary's PDF at the dots it would have sent as PNG. */
async function drawPages(
  data: ArrayBuffer,
  printDensity: PrintDensity,
  signal?: AbortSignal,
) {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data })
  try {
    const pdf = await task.promise
    const scale = labelaryDpi(printDensity) / POINTS_PER_INCH
    const labels: LabelaryLabel[] = []
    for (let number = 1; number <= pdf.numPages; number++) {
      signal?.throwIfAborted()
      const page = await pdf.getPage(number)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      // Pages measure a whole number of dots, give or take float error.
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvas, viewport }).promise
      labels.push({
        canvas,
        width: canvas.width,
        height: canvas.height,
        printDensity,
      })
    }
    return labels
  } finally {
    void task.destroy()
  }
}

/** pdf.js is only needed once a label renders, so it's fetched on first use. */
let pdfjsLoad: Promise<typeof Pdfjs> | undefined
function loadPdfjs() {
  // Labels only render in the browser; this keeps pdf.js out of the worker.
  if (import.meta.env.SSR) throw new Error('pdf.js runs in the browser only')
  // The legacy build polyfills the newest JavaScript the default build
  // assumes, which current Safari and Firefox lack.
  pdfjsLoad ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })
  return pdfjsLoad
}

async function requestLabels(
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
    headers: { Accept: 'application/pdf', 'X-Linter': 'On' },
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

/** Labelary converts at dpmm × 25.4 dpi with the fraction dropped. */
function labelaryDpi(printDensity: PrintDensity) {
  return Math.floor(printDensity * MM_PER_INCH)
}

/** Leaving out the label index asks for every label, one per PDF page. */
function labelsUrl(settings: LabelSettings) {
  // Labelary converts at 152, 203, 304 or 609 dpi, not the nominal 300 /
  // 600, then rounds the dots down. Aim half a dot past the size we want:
  // 812 dots at 203 dpi is sent as 4.0025 in.
  const { width, height } = labelDots(settings)
  const dpi = labelaryDpi(settings.dpmm)
  const inches = (dots: number) => ((dots + 0.5) / dpi).toFixed(4)
  return `${API_URL}/${settings.dpmm}dpmm/labels/${inches(width)}x${inches(height)}/`
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
