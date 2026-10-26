import type { PrintDensity, ZplLabelNode } from 'zplr/web'

export type { PrintDensity } from 'zplr/web'

export interface LabelSettings {
  /** Print-head density in dots per millimetre. */
  dpmm: PrintDensity
  /** Label size, which wins over the ZPL's ^PW / ^LL like media in a printer. */
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

/**
 * The label size in dots, converted at the nominal dpi so a 4 × 6 in label
 * is 812 × 1218 dots, matching what ^PW / ^LL would say.
 */
export function labelDots(settings: LabelSettings): {
  width: number
  height: number
} {
  const dpi = dpiFor(settings.dpmm)
  return {
    width: Math.round(settings.widthIn * dpi),
    height: Math.round(settings.heightIn * dpi),
  }
}

/** The size a label's ^PW / ^LL ask for, in dots; either may be missing. */
export interface ZplSize {
  width?: number
  height?: number
}

/** What the first label's ^PW / ^LL ask for, which the settings override. */
export async function readZplSize(
  source: string,
  dpmm: PrintDensity,
): Promise<ZplSize> {
  // The store imports this module for its settings, which puts it in the
  // entry chunk; importing the parser here keeps zplr out of it.
  const { parseDocument } = await import('zplr/web')
  const label = parseDocument(source).labels.at(0)
  if (!label) return {}
  return {
    width: commandDots(label, '^PW', dpmm),
    height: commandDots(label, '^LL', dpmm),
  }
}

/**
 * The last value `canonical` sets, in dots, the way a printer reads it: in
 * the ^MU units in force, and ^LL only before the first ^FS.
 */
function commandDots(
  label: ZplLabelNode,
  canonical: '^PW' | '^LL',
  dpmm: PrintDensity,
) {
  let dots: number | undefined
  let unit = 'D'
  let fieldSeparated = false
  for (const command of label.commands) {
    if (command.canonical === '^FS') fieldSeparated = true
    else if (command.canonical === '^MU') {
      const requested = command.parameters[0]?.trim().toUpperCase()
      if (!requested || ['D', 'I', 'M'].includes(requested)) {
        unit = requested || 'D'
      }
    } else if (
      command.canonical === canonical &&
      !(canonical === '^LL' && fieldSeparated)
    ) {
      const value = Number(command.parameters[0]?.trim() || NaN)
      if (Number.isFinite(value) && value > 0) {
        const scale =
          unit === 'I' ? dpmm * MM_PER_INCH : unit === 'M' ? dpmm : 1
        dots = Math.round(value * scale)
      }
    }
  }
  return dots
}
