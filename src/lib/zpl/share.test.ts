import { deflateSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { ShareLinkError, decodeShareHash, encodeShareHash } from './share'

const ZPL = '^XA\n^FO50,50^A0N,40,40^FDHéllo, wörld ✓^FS\n^XZ\n'
const SETTINGS = { dpmm: 12, widthIn: 4, heightIn: 6.5 } as const

describe('share links', () => {
  it('round-trips the ZPL and settings', () => {
    expect(decodeShareHash(encodeShareHash(ZPL, SETTINGS))).toEqual({
      source: ZPL,
      settings: SETTINGS,
    })
  })

  it('accepts the fragment with its #', () => {
    const hash = `#${encodeShareHash(ZPL, SETTINGS)}`
    expect(decodeShareHash(hash)?.source).toBe(ZPL)
  })

  it('only uses characters that survive a URL as-is', () => {
    const hash = encodeShareHash(ZPL.repeat(20), SETTINGS)
    expect(hash).toMatch(/^[\w.=&-]+$/)
  })

  it('compresses repetitive ZPL', () => {
    const source = '^FO10,10^GB100,100,3^FS\n'.repeat(200)
    expect(encodeShareHash(source, SETTINGS).length).toBeLessThan(
      source.length / 10,
    )
  })

  it('reads plain base64 ZPL from a fragment or query string', () => {
    const base64 = btoa('^XA^FO50,50^FDHello^FS^XZ')
    const query = `?${new URLSearchParams({ base64, dpmm: '8' })}`
    expect(decodeShareHash(`#base64=${base64}`)?.source).toBe(
      '^XA^FO50,50^FDHello^FS^XZ',
    )
    expect(decodeShareHash(query)).toEqual({
      source: '^XA^FO50,50^FDHello^FS^XZ',
      settings: { dpmm: 8, widthIn: 0, heightIn: 0 },
    })
  })

  it('accepts base64 whose + was not escaped', () => {
    const source = '^XA^FO10,10^FD>>>???^FS^XZ'
    const base64 = btoa(source)
    expect(base64).toContain('+')
    expect(decodeShareHash(`?base64=${base64}`)?.source).toBe(source)
  })

  it('rejects base64 that is not ZPL', () => {
    expect(() => decodeShareHash('base64=aGVsbG8gd29ybGQ')).toThrow(
      ShareLinkError,
    )
  })

  it('ignores fragments that are not share links', () => {
    expect(decodeShareHash('')).toBeNull()
    expect(decodeShareHash('#editor')).toBeNull()
  })

  it('leaves missing settings for the caller to fill in', () => {
    const [zpl] = encodeShareHash(ZPL, SETTINGS).split('&')
    expect(decodeShareHash(zpl)?.settings).toEqual({
      dpmm: 0,
      widthIn: 0,
      heightIn: 0,
    })
  })

  it('rejects a link that was cut short', () => {
    const hash = encodeShareHash(ZPL.repeat(20), SETTINGS)
    const truncated = hash.slice(0, hash.indexOf('&') - 10)
    expect(() => decodeShareHash(truncated)).toThrow(ShareLinkError)
  })

  it('rejects data that is not compressed ZPL', () => {
    expect(() => decodeShareHash('zpl=not*base64')).toThrow(ShareLinkError)
    expect(() => decodeShareHash('zpl=aGVsbG8')).toThrow(ShareLinkError)
  })

  it('refuses to inflate past the size limit', () => {
    const bomb = deflateSync(new Uint8Array(9 * 1024 * 1024), { level: 9 })
    let binary = ''
    for (const byte of bomb) binary += String.fromCharCode(byte)
    const data = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_')
    expect(() => decodeShareHash(`zpl=${data}`)).toThrow(/too large/)
  })
})
