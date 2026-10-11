import { describe, expect, it } from 'vitest'

import { decodeBase64Zpl, encodeBase64 } from './base64'

const ZPL = '^XA^FO50,50^A0N,40,40^FDHello^FS^XZ'

describe('decodeBase64Zpl', () => {
  it('ignores plain ZPL', () => {
    expect(decodeBase64Zpl(ZPL)).toBeNull()
  })

  it('decodes base64 ZPL', () => {
    expect(decodeBase64Zpl(btoa(ZPL))).toBe(ZPL)
  })

  it('tolerates surrounding and embedded whitespace', () => {
    const wrapped = btoa(ZPL).replace(/(.{16})/g, '$1\n')
    expect(decodeBase64Zpl(`  \n${wrapped}\n `)).toBe(ZPL)
  })

  it('decodes URL-safe base64 without padding', () => {
    const zpl = '^XA^FO10,10^FD???>>>^FS^XZ'
    const urlSafe = btoa(zpl)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(urlSafe).toMatch(/[-_]/)
    expect(decodeBase64Zpl(urlSafe)).toBe(zpl)
  })

  it('strips a data URI prefix', () => {
    expect(decodeBase64Zpl(`data:application/zpl;base64,${btoa(ZPL)}`)).toBe(
      ZPL,
    )
  })

  it('decodes double-encoded input', () => {
    expect(decodeBase64Zpl(btoa(btoa(ZPL)))).toBe(ZPL)
  })

  it('rejects base64 that is not ZPL', () => {
    expect(decodeBase64Zpl(btoa('just some ordinary text'))).toBeNull()
  })

  it('rejects short or invalid input', () => {
    expect(decodeBase64Zpl('')).toBeNull()
    expect(decodeBase64Zpl('abc')).toBeNull()
    expect(decodeBase64Zpl('not base64 at all!')).toBeNull()
  })

  it('accepts ZPL fragments without ^XA', () => {
    const fragment = '^FO10,10^FDHi^FS'
    expect(decodeBase64Zpl(btoa(fragment))).toBe(fragment)
  })
})

describe('encodeBase64', () => {
  it('round-trips non-ASCII field data', () => {
    const zpl = '^XA^CI28^FO10,10^FDDéjà vu – Größe ✓^FS^XZ'
    expect(decodeBase64Zpl(encodeBase64(zpl))).toBe(zpl)
  })
})
