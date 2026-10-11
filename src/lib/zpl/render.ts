import { renderZpl } from 'zplr/web'
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

export function dotsToInches(dots: number, dpmm: PrintDensity): number {
  return dots / dpmm / MM_PER_INCH
}

export function toRenderOptions(settings: LabelSettings): RenderJobOptions {
  return {
    printDensity: settings.dpmm,
    fallbackSize: {
      width: settings.widthIn,
      height: settings.heightIn,
      unit: 'in',
    },
    limits: { maxLabels: 50 },
  }
}

export function renderLabels(source: string, settings: LabelSettings) {
  return renderZpl(source, toRenderOptions(settings))
}
