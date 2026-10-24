import { describe, expect, it } from 'vitest'

import { DIFF_COLORS, diffInk } from './diff'
import type { Raster } from './diff'

const INK = [0, 0, 0, 255]
const PAPER = [255, 255, 255, 255]
const CLEAR = [0, 0, 0, 0]

function raster(width: number, rows: number[][][]): Raster {
  return {
    width,
    height: rows.length,
    data: new Uint8ClampedArray(rows.flat(2)),
  }
}

function pixel(diff: Raster, x: number, y: number) {
  const offset = (y * diff.width + x) * 4
  return Array.from(diff.data.slice(offset, offset + 3))
}

describe('diffInk', () => {
  it('colours each dot by which raster inked it', () => {
    const a = raster(2, [
      [INK, INK],
      [PAPER, PAPER],
    ])
    const b = raster(2, [
      [INK, PAPER],
      [INK, PAPER],
    ])
    const diff = diffInk(a, b)

    expect(pixel(diff, 0, 0)).toEqual(DIFF_COLORS.both)
    expect(pixel(diff, 1, 0)).toEqual(DIFF_COLORS.onlyA)
    expect(pixel(diff, 0, 1)).toEqual(DIFF_COLORS.onlyB)
    expect(pixel(diff, 1, 1)).toEqual(DIFF_COLORS.paper)
    expect(diff).toMatchObject({ differing: 2, inked: 3 })
  })

  it('treats transparent dots as paper', () => {
    const a = raster(1, [[CLEAR]])
    const b = raster(1, [[PAPER]])
    expect(diffInk(a, b)).toMatchObject({ differing: 0, inked: 0 })
  })

  it('covers the larger raster when sizes differ', () => {
    const a = raster(1, [[INK]])
    const b = raster(2, [
      [INK, INK],
      [PAPER, PAPER],
    ])
    const diff = diffInk(a, b)

    expect(diff).toMatchObject({ width: 2, height: 2, differing: 1 })
    expect(pixel(diff, 1, 0)).toEqual(DIFF_COLORS.onlyB)
  })
})
