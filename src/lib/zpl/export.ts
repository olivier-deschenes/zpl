import { zipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'

import { encodeBase64 } from './base64'
import { dotsToInches, renderLabels } from './render'
import type { LabelSettings, RenderedLabel } from './render'

const POINTS_PER_INCH = 72

export async function exportPng(source: string, settings: LabelSettings) {
  const { labels } = await renderLabels(source, settings)
  const pngs = await Promise.all(labels.map(toPngBytes))
  if (pngs.length === 0) throw new Error('No labels to export')

  if (pngs.length === 1) {
    downloadBlob(new Blob([pngs[0]], { type: 'image/png' }), 'label.png')
    return
  }

  const files = Object.fromEntries(
    pngs.map((png, index) => [`label-${index + 1}.png`, png]),
  )
  // PNG is already compressed, so store the entries as-is.
  const zip = zipSync(files, { level: 0 })
  downloadBlob(new Blob([zip], { type: 'application/zip' }), 'labels.zip')
}

export async function exportPdf(source: string, settings: LabelSettings) {
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
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'label.pdf')
}

export function copyZpl(source: string) {
  return writeClipboard(source)
}

export function copyBase64(source: string) {
  return writeClipboard(encodeBase64(source))
}

async function writeClipboard(text: string) {
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

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 0)
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
