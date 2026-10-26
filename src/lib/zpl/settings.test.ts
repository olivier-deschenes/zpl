import { describe, expect, it } from 'vitest'

import { readZplSize } from './settings'

describe('readZplSize', () => {
  it('reads ^PW and ^LL in dots', async () => {
    expect(await readZplSize('^XA^PW812^LL1218^XZ', 8)).toEqual({
      width: 812,
      height: 1218,
    })
  })

  it('leaves out what the ZPL does not set', async () => {
    expect(await readZplSize('^XA^PW400^FO0,0^FDx^FS^XZ', 8)).toEqual({
      width: 400,
      height: undefined,
    })
    expect(await readZplSize('', 8)).toEqual({})
  })

  it('converts ^MU inches and millimetres', async () => {
    expect(await readZplSize('^XA^MUI^PW2^MUM^LL50^XZ', 8)).toEqual({
      width: Math.round(2 * 8 * 25.4),
      height: 400,
    })
  })

  it('ignores ^LL after the first field, like a printer', async () => {
    expect(
      (await readZplSize('^XA^LL300^FO0,0^FDx^FS^LL900^XZ', 8)).height,
    ).toBe(300)
  })
})
