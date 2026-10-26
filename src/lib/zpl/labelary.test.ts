import { describe, expect, it } from 'vitest'

import { parseWarnings } from './labelary'

describe('parseWarnings', () => {
  it('reads each group of five fields', () => {
    const source = '^XA^FO10,10^GB-5,10^FS^XZ'
    expect(
      parseWarnings(
        source,
        '14|2|^GB|1|Value -5 is less than minimum value 1; used 1 instead|20|3|^FS|1|Second',
      ),
    ).toEqual([
      {
        from: 14,
        to: 16,
        command: '^GB',
        message: 'Value -5 is less than minimum value 1; used 1 instead',
      },
      { from: 20, to: 23, command: '^FS', message: 'Second' },
    ])
  })

  it('maps UTF-8 byte offsets to string indices', () => {
    // "é" is two bytes and "😀" four, but one and two UTF-16 units.
    const source = '^XA^FDé😀^FS^GB-5^XZ'
    const [warning] = parseWarnings(source, '18|2|^GB|1|Too small')
    expect(source.slice(warning.from, warning.to)).toBe('-5')
  })

  it('ignores an empty or malformed header', () => {
    expect(parseWarnings('^XA^XZ', '')).toEqual([])
    expect(parseWarnings('^XA^XZ', 'x|y|^GB|1|Bad')).toEqual([])
  })
})
