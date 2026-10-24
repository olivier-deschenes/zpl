import { describe, expect, it } from 'vitest'
import { findCommandAtOffset, parseDocument } from 'zplr/web'

import { explainCommand, explainDocument, parameterIndexAt } from './explain'

const context = { dpi: 203 }

function hints(source: string) {
  return explainDocument(parseDocument(source), context).map(
    (hint) => hint.text,
  )
}

function command(source: string, offset = 0) {
  const found = findCommandAtOffset(parseDocument(source), offset)
  if (!found) throw new Error(`No command at ${offset}`)
  return found
}

describe('explainDocument', () => {
  it('sums up each field in one line', () => {
    expect(
      hints(
        '^XA^CF0,30^FO50,50^FDAcme Shipping Co.^FS^FO50,170^GB712,3,3^FS^XZ',
      ),
    ).toEqual([
      'Start of label',
      'Text below uses font 0 at 30 dots tall',
      'Text “Acme Shipping Co.”, 30 dots tall, at (50, 50)',
      'Horizontal line, 712 dots long, at (50, 170)',
      'End of label',
    ])
  })

  it('uses the field’s own font and inversion', () => {
    expect(hints('^XA^FO110,1050^FR^A0R,80,80^FDPRIORITY^FS^XZ')).toContain(
      'Text “PRIORITY”, 80 dots tall, rotated 90° clockwise, printed inverted, at (110, 1050)',
    )
  })

  it('names barcodes and falls back to the ^BY height', () => {
    expect(
      hints('^XA^BY3,3,200^FO70,440^BCN,,Y,N,N^FD1Z999AA10123456784^FS^XZ'),
    ).toContain(
      'Code 128 barcode “1Z999AA10123456784”, 200 dots tall, at (70, 440)',
    )
  })

  it('strips the QR mode prefix from its content', () => {
    expect(
      hints('^XA^FO570,750^BQN,2,6^FDQA,https://example.com/track^FS^XZ'),
    ).toContain('QR Code “https://example.com/track”, at (570, 750)')
  })

  it('tells boxes, solid boxes and lines apart', () => {
    expect(
      hints(
        '^XA^FO0,0^GB712,250,3^FS^FO0,0^GB712,150,150^FS^FO0,0^GB3,400,3^FS^XZ',
      ),
    ).toEqual([
      'Start of label',
      'Box outline, 712 × 250 dots, at (0, 0)',
      'Solid box, 712 × 150 dots, at (0, 0)',
      'Vertical line, 400 dots long, at (0, 0)',
      'End of label',
    ])
  })

  it('leaves comments alone and converts label size to inches', () => {
    expect(hints('^XA^FX note^PW812^LL1218^XZ')).toEqual([
      'Start of label',
      'Label is 812 dots (4 in) wide',
      'Label is 1218 dots (6 in) long',
      'End of label',
    ])
  })
})

describe('explainCommand', () => {
  it('explains each value of ^FO in dots and inches', () => {
    const { name, parameters } = explainCommand(command('^FO50,100'), context)
    expect(name).toBe('Field Origin')
    expect(parameters.slice(0, 2)).toEqual([
      {
        name: 'x',
        value: '50',
        meaning: '50 dots (0.25 in) from the left edge',
        rawIndex: 0,
      },
      {
        name: 'y',
        value: '100',
        meaning: '100 dots (0.49 in) from the top edge',
        rawIndex: 1,
      },
    ])
    expect(parameters[2]).toMatchObject({
      value: null,
      meaning: 'Left-aligned',
    })
  })

  it('splits the ^A font name from its orientation', () => {
    const { parameters } = explainCommand(command('^A0N,80,80'), context)
    expect(parameters.map((parameter) => parameter.value)).toEqual([
      '0',
      'N',
      '80',
      '80',
    ])
    expect(parameters.map((parameter) => parameter.rawIndex)).toEqual([
      0, 0, 1, 2,
    ])
  })

  it('keeps field data whole, commas and all', () => {
    const { parameters } = explainCommand(command('^FDHi, there'), context)
    expect(parameters).toEqual([
      {
        name: 'content',
        value: 'Hi, there',
        meaning: '“Hi, there”',
        rawIndex: 0,
      },
    ])
  })

  it('falls back on the category for commands without a guide', () => {
    expect(explainCommand(command('^BZN,40'), context).summary).toMatch(
      /^Draws a Postal barcode/,
    )
    expect(explainCommand(command('^JUS'), context).summary).toMatch(
      /^A printer setting/,
    )
  })
})

describe('parameterIndexAt', () => {
  it('finds which value an offset is in', () => {
    const fo = command('^FO50,100')
    expect(parameterIndexAt(fo, 1)).toBeNull()
    expect(parameterIndexAt(fo, 4)).toBe(0)
    expect(parameterIndexAt(fo, 7)).toBe(1)
  })
})
