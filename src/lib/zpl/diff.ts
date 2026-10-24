/** RGBA pixels, laid out like `ImageData`. */
export interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface InkDiff extends Raster {
  data: Uint8ClampedArray<ArrayBuffer>
  /** Dots inked in exactly one of the two rasters. */
  differing: number
  /** Dots inked in either raster. */
  inked: number
}

type Rgb = readonly [number, number, number]

/** Labels are always black on white paper, so these don't follow the theme. */
export const DIFF_COLORS = {
  both: [143, 143, 143],
  onlyA: [0, 104, 214],
  onlyB: [217, 63, 11],
  paper: [255, 255, 255],
} as const satisfies Record<string, Rgb>

export function rgb([r, g, b]: Rgb) {
  return `rgb(${r} ${g} ${b})`
}

/**
 * Overlays two label rasters, aligned at the top-left corner: dots inked in
 * both are grey, and dots inked in only one take that raster's colour.
 */
export function diffInk(a: Raster, b: Raster): InkDiff {
  const width = Math.max(a.width, b.width)
  const height = Math.max(a.height, b.height)
  const data = new Uint8ClampedArray(width * height * 4)
  let differing = 0
  let inked = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inA = isInk(a, x, y)
      const inB = isInk(b, x, y)
      if (inA || inB) inked++
      if (inA !== inB) differing++

      const color = inA
        ? inB
          ? DIFF_COLORS.both
          : DIFF_COLORS.onlyA
        : inB
          ? DIFF_COLORS.onlyB
          : DIFF_COLORS.paper
      const offset = (y * width + x) * 4
      data[offset] = color[0]
      data[offset + 1] = color[1]
      data[offset + 2] = color[2]
      data[offset + 3] = 255
    }
  }

  return { width, height, data, differing, inked }
}

/** A dark, mostly opaque dot. Transparent dots are blank paper. */
function isInk(raster: Raster, x: number, y: number) {
  if (x >= raster.width || y >= raster.height) return false
  const offset = (y * raster.width + x) * 4
  const { data } = raster
  if (data[offset + 3] < 128) return false
  const luma =
    data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
  return luma < 128
}
