import { afterEach, describe, expect, it, vi } from 'vitest'

import { readCached, writeCached } from './render-cache'

afterEach(() => vi.unstubAllGlobals())

describe('render cache', () => {
  it.each([0, 249, 250, 498, 499, 500, 501])(
    'keeps the newest 500 renders after adding to %i cached renders',
    async (count) => {
      const keys = Array.from(
        { length: count },
        (_, index) => `render-${index}`,
      )
      const entries = new Map(keys.map((key) => [key, new Response('old')]))
      const cache = {
        put: vi.fn(async (key: string, response: Response) => {
          entries.set(key, response)
        }),
        keys: vi.fn(async () => [...entries.keys()]),
        delete: vi.fn(async (key: string) => entries.delete(key)),
        match: vi.fn(async (key: string) => entries.get(key)),
      }
      vi.stubGlobal('caches', { open: vi.fn(async () => cache) })

      await writeCached(
        'new-render',
        new Response('pdf bytes', {
          headers: { 'X-Total-Count': '2', 'X-Warnings': 'a warning' },
        }),
      )

      expect([...entries.keys()]).toEqual([...keys, 'new-render'].slice(-500))
      const cached = await readCached('new-render')
      expect(await cached?.text()).toBe('pdf bytes')
      expect(cached?.headers.get('Content-Type')).toBe('application/pdf')
      expect(cached?.headers.get('X-Total-Count')).toBe('2')
      expect(cached?.headers.get('X-Warnings')).toBe('a warning')
    },
  )

  it('treats unavailable Cache Storage as a cache miss', async () => {
    vi.stubGlobal('caches', undefined)
    expect(await readCached('render')).toBeUndefined()
    await expect(
      writeCached('render', new Response('pdf')),
    ).resolves.toBeUndefined()
  })

  it('ignores storage failures so rendering can continue', async () => {
    const fail = async () => {
      throw new Error('Storage unavailable')
    }
    vi.stubGlobal('caches', { open: fail })
    expect(await readCached('render')).toBeUndefined()
    await expect(
      writeCached('render', new Response('pdf')),
    ).resolves.toBeUndefined()

    vi.stubGlobal('caches', { open: async () => ({ match: fail, put: fail }) })
    expect(await readCached('render')).toBeUndefined()
    await expect(
      writeCached('render', new Response('pdf')),
    ).resolves.toBeUndefined()
  })
})
