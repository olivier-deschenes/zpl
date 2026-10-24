import { zipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'

import { encodeBase64 } from './base64'
import { dotsToInches, renderLabels } from './render'
import type { LabelSettings, RenderedLabel } from './render'

const POINTS_PER_INCH = 72

export type ExportFormat = 'png' | 'pdf' | 'zpl'

export const DEFAULT_FILE_NAME = 'label'

// Characters Windows, macOS or Linux refuse in a file name.
// eslint-disable-next-line no-control-regex -- control characters are the point
const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g

/**
 * Turns what someone typed into a safe base name: drops the extension they
 * may have added out of habit and replaces characters file systems reject.
 * Returns an empty string when nothing usable is left.
 */
export function toFileBaseName(input: string, format: ExportFormat): string {
  const safe = trimFileName(input.replace(UNSAFE_FILE_NAME_CHARS, '-'))
  return trimFileName(safe.replace(new RegExp(`\\.${format}$`, 'i'), ''))
}

/** Leading dots hide a file; trailing dots and spaces trip up Windows. */
function trimFileName(name: string) {
  return name.replace(/^[\s.]+|[\s.]+$/g, '')
}

/** Downloads the label in `format` and returns the name it was saved under. */
export function exportAs(
  format: ExportFormat,
  source: string,
  settings: LabelSettings,
  baseName: string,
): Promise<string> {
  switch (format) {
    case 'png':
      return exportPng(source, settings, baseName)
    case 'pdf':
      return exportPdf(source, settings, baseName)
    case 'zpl':
      return Promise.resolve(exportZpl(source, baseName))
  }
}

/** A single PNG downloads as-is; several are bundled in a zip. */
export async function exportPng(
  source: string,
  settings: LabelSettings,
  baseName: string,
) {
  const { labels } = await renderLabels(source, settings)
  const pngs = await Promise.all(labels.map(toPngBytes))
  if (pngs.length === 0) throw new Error('No labels to export')

  if (pngs.length === 1) {
    return downloadBlob(
      new Blob([pngs[0]], { type: 'image/png' }),
      `${baseName}.png`,
    )
  }

  const files = Object.fromEntries(
    pngs.map((png, index) => [`${baseName}-${index + 1}.png`, png]),
  )
  // PNG is already compressed, so store the entries as-is.
  const zip = zipSync(files, { level: 0 })
  return downloadBlob(
    new Blob([zip], { type: 'application/zip' }),
    `${baseName}.zip`,
  )
}

export async function exportPdf(
  source: string,
  settings: LabelSettings,
  baseName: string,
) {
  const { labels } = await renderLabels(source, settings)
  if (labels.length === 0) throw new Error('No labels to export')

  const pdf = await PDFDocument.create()
  for (const label of labels) {
    const image = await pdf.embedPng(await toPngBytes(label))
    const width =
      dotsToInches(label.width, label.printDensity) * POINTS_PER_INCH
    const height =
      dotsToInches(label.height, label.printDensity) * POINTS_PER_INCH
    pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height })
  }

  // pdf-lib always allocates a plain ArrayBuffer, never a shared one.
  const bytes = (await pdf.save()) as Uint8Array<ArrayBuffer>
  return downloadBlob(
    new Blob([bytes], { type: 'application/pdf' }),
    `${baseName}.pdf`,
  )
}

export function exportZpl(source: string, baseName: string) {
  if (!source.trim()) throw new Error('No ZPL to export')
  // A text/plain type makes Safari tack .txt onto the name.
  return downloadBlob(
    new Blob([source], { type: 'application/octet-stream' }),
    `${baseName}.zpl`,
  )
}

export function copyZpl(source: string) {
  return writeClipboard(source)
}

export function copyBase64(source: string) {
  return writeClipboard(encodeBase64(source))
}

export async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    // Some embedded browsers deny the async clipboard API outright.
    if (!legacyCopy(text)) throw error
  }
}

function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}

/** Returns `filename` so exporters can report what they saved. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return filename
}

function toPngBytes(
  label: RenderedLabel<HTMLCanvasElement>,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    label.canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The label could not be encoded as PNG'))
        return
      }
      blob
        .arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)), reject)
    }, 'image/png')
  })
}
