import type { PrintDensity, RenderJobOptions } from 'zplr/web'

export type {
  HighlightRegion,
  PrintDensity,
  RenderJobResult,
  RenderedLabel,
  SourceSpan,
  ZplDiagnostic,
} from 'zplr/web'

export interface LabelSettings {
  /** Print-head density in dots per millimetre. */
  dpmm: PrintDensity
  /** Fallback label size, used when the ZPL has no ^PW / ^LL. */
  widthIn: number
  heightIn: number
}

export const DENSITIES: ReadonlyArray<{ dpmm: PrintDensity; dpi: number }> = [
  { dpmm: 6, dpi: 152 },
  { dpmm: 8, dpi: 203 },
  { dpmm: 12, dpi: 300 },
  { dpmm: 24, dpi: 600 },
]

export const DEFAULT_SETTINGS: LabelSettings = {
  dpmm: 8,
  widthIn: 4,
  heightIn: 6,
}

export const MIN_SIZE_IN = 0.25
export const MAX_SIZE_IN = 30

const MM_PER_INCH = 25.4

export function dpiFor(dpmm: PrintDensity): number {
  return (
    DENSITIES.find((density) => density.dpmm === dpmm)?.dpi ??
    Math.round(dpmm * MM_PER_INCH)
  )
}

/**
 * Uses the printer's nominal dpi (203, 300, …) rather than dpmm × 25.4, the
 * way label sizes are specified: 812 × 1218 dots at 203 dpi is 4 × 6 in.
 */
export function dotsToInches(dots: number, dpmm: PrintDensity): number {
  return dots / dpiFor(dpmm)
}

export function toRenderOptions(settings: LabelSettings): RenderJobOptions {
  // Convert at the nominal dpi so a 4 × 6 in label is 812 × 1218 dots,
  // matching what ^PW/^LL would say, rather than zplr's 813 × 1219.
  const dpi = dpiFor(settings.dpmm)
  return {
    printDensity: settings.dpmm,
    fallbackSize: {
      width: Math.round(settings.widthIn * dpi),
      height: Math.round(settings.heightIn * dpi),
      unit: 'dots',
    },
    limits: { maxLabels: 50 },
  }
}

export async function renderLabels(source: string, settings: LabelSettings) {
  // The store imports this module for its settings, which puts it in the
  // entry chunk; importing the renderer here keeps zplr, with its barcode
  // and font engines, out of it.
  const { renderZpl } = await import('zplr/web')
  return renderZpl(source, toRenderOptions(settings))
}
