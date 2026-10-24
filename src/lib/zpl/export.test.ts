import { describe, expect, it } from 'vitest'

import { toFileBaseName } from './export'

describe('toFileBaseName', () => {
  it('keeps a plain name', () => {
    expect(toFileBaseName('shipping label', 'pdf')).toBe('shipping label')
  })

  it('drops the extension when it was typed', () => {
    expect(toFileBaseName('label.pdf', 'pdf')).toBe('label')
    expect(toFileBaseName('label.PNG', 'png')).toBe('label')
    expect(toFileBaseName('label.pdf.', 'pdf')).toBe('label')
  })

  it('keeps an extension for another format', () => {
    expect(toFileBaseName('label.zpl', 'pdf')).toBe('label.zpl')
  })

  it('replaces characters file systems reject', () => {
    expect(toFileBaseName('a/b\\c:d*e?"f<g>h|i', 'zpl')).toBe(
      'a-b-c-d-e-f-g-h-i',
    )
  })

  it('trims spaces and dots from the edges', () => {
    expect(toFileBaseName('  .hidden. ', 'png')).toBe('hidden')
  })

  it('returns an empty string when nothing is left', () => {
    expect(toFileBaseName('   ', 'pdf')).toBe('')
    expect(toFileBaseName(' ... ', 'pdf')).toBe('')
  })
})
