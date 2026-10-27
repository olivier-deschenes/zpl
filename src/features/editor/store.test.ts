import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from '#/lib/zpl/settings'

const STORAGE_KEY = 'zpl-editor:v3'
let saved: Map<string, string>
let storage: {
  getItem: ReturnType<typeof vi.fn>
  setItem: ReturnType<typeof vi.fn>
  removeItem: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.resetModules()
  saved = new Map()
  storage = {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      saved.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      saved.delete(key)
    }),
  }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('window', {})
})

afterEach(() => vi.unstubAllGlobals())

const load = () => import('./store')
async function reload() {
  vi.resetModules()
  return load()
}

describe('server initialization', () => {
  it('loads without browser storage or random generation at Worker module scope', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('localStorage', undefined)
    const getRandomValues = vi.fn(() => {
      throw new Error('Disallowed operation called within global scope')
    })
    vi.stubGlobal('crypto', { getRandomValues })

    const app = await load()

    expect(getRandomValues).not.toHaveBeenCalled()
    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(app.editorStore.state.files).toEqual([])
    expect(app.editorStore.state.openFileIds).toEqual([])
    expect(app.editorStore.state.activeFileId).toBeNull()
  })
})

describe('saved files', () => {
  it('only persists settings when a value changes', async () => {
    const app = await load()
    const before = app.editorStore.state
    const id = before.openFileIds[0]
    storage.setItem.mockClear()

    app.setSettings(id, {})
    app.setSettings(id, { ...DEFAULT_SETTINGS })

    expect(app.editorStore.state).toBe(before)
    expect(storage.setItem).not.toHaveBeenCalled()

    app.setSettings(id, { widthIn: 2 })

    expect(app.selectFile(app.editorStore.state, id)?.settings).toEqual({
      ...DEFAULT_SETTINGS,
      widthIn: 2,
    })
    expect(storage.setItem).toHaveBeenCalledTimes(1)
  })

  it('keeps source, settings, name, and tab selection across close, reload, and reopen', async () => {
    let app = await load()
    const first = app.editorStore.state.openFileIds[0]
    app.setSource(first, '^XA^FDShipping^FS^XZ')
    app.setSettings(first, { widthIn: 3, heightIn: 5, dpmm: 12 })
    app.setFileName(first, 'Shipping.zpl')
    const expected = app.selectFile(app.editorStore.state, first)
    const second = app.addFile()!
    app.closeFile(first)
    app = await reload()
    expect(app.editorStore.state.openFileIds).toEqual([second])
    expect(app.editorStore.state.activeFileId).toBe(second)
    expect(app.selectFile(app.editorStore.state, first)).toEqual(expected)
    expect(app.openFile(first)).toBe(true)
    expect(app.editorStore.state.activeFileId).toBe(first)
    expect(app.editorStore.state.files).toHaveLength(2)
    app = await reload()
    expect(app.editorStore.state.openFileIds).toEqual([second, first])
    expect(app.editorStore.state.activeFileId).toBe(first)
    expect(app.selectFile(app.editorStore.state, first)).toEqual(expected)
  })

  it('persists zero open tabs without replacing the saved file with a sample', async () => {
    let app = await load()
    const id = app.editorStore.state.openFileIds[0]
    app.setSource(id, 'saved label')
    app.closeFile(id)
    app = await reload()
    expect(app.editorStore.state.openFileIds).toEqual([])
    expect(app.editorStore.state.activeFileId).toBeNull()
    expect(app.editorStore.state.files).toMatchObject([
      { id, source: 'saved label' },
    ])
    expect(app.addFile()).toBeTruthy()
    expect(app.editorStore.state.files).toHaveLength(2)
  })

  it('removes deleted files from storage, including the last file, without resurrecting them', async () => {
    let app = await load()
    const id = app.editorStore.state.openFileIds[0]
    app.setSource(id, 'a unique deleted source')
    app.setPreviewZoom(id, 2)
    app.deleteFile(id)
    expect(app.zoomStore.state[id]).toBeUndefined()
    expect(saved.get(STORAGE_KEY)).not.toContain('a unique deleted source')
    app = await reload()
    expect(app.editorStore.state.files).toEqual([])
    expect(app.editorStore.state.openFileIds).toEqual([])
    expect(app.editorStore.state.activeFileId).toBeNull()
    expect(app.addFile()).toBeTruthy()
    expect(app.editorStore.state.files).toHaveLength(1)
  })

  it('deletes closed files without disturbing the active editor', async () => {
    const app = await load()
    const first = app.editorStore.state.openFileIds[0]
    const second = app.addFile()!
    app.closeFile(first)
    app.deleteFile(first)
    expect(app.editorStore.state.openFileIds).toEqual([second])
    expect(app.editorStore.state.activeFileId).toBe(second)
    expect(app.openFile(first)).toBe(false)
  })

  it('selects the adjacent tab when closing an active tab and preserves unrelated selection', async () => {
    const app = await load()
    const first = app.editorStore.state.openFileIds[0]
    const second = app.addFile()!
    const third = app.addFile()!
    app.setActiveFile(second)
    app.closeFile(first)
    expect(app.editorStore.state.activeFileId).toBe(second)
    app.closeFile(second)
    expect(app.editorStore.state.activeFileId).toBe(third)
    app.setActiveFile('missing')
    expect(app.editorStore.state.activeFileId).toBe(third)
  })

  it('allows more saved files than simultaneous editors without dropping files at the limit', async () => {
    const app = await load()
    const first = app.editorStore.state.openFileIds[0]
    app.closeFile(first)
    for (let i = 0; i < app.MAX_PANELS; i++) expect(app.addFile()).toBeTruthy()
    const before = app.editorStore.state
    expect(app.addFile()).toBeUndefined()
    expect(app.duplicateFile(first)).toBeUndefined()
    expect(app.openFile(first)).toBe(false)
    expect(app.editorStore.state).toBe(before)
    expect(app.editorStore.state.files).toHaveLength(5)
    app.closeFile(app.editorStore.state.openFileIds[0])
    expect(app.openFile(first)).toBe(true)
    expect(app.editorStore.state.files).toHaveLength(5)
  })

  it('duplicates a file with its own identity and preserves the original when the copy changes', async () => {
    const app = await load()
    const original = app.editorStore.state.openFileIds[0]
    app.setFileName(original, 'Shipping')
    app.setSource(original, 'original source')
    const copy = app.duplicateFile(original)!
    expect(app.selectFile(app.editorStore.state, copy)).toMatchObject({
      source: 'original source',
      fileName: 'Shipping-copy',
    })
    app.setSource(copy, 'changed copy')
    app.setSettings(copy, { widthIn: 2 })
    expect(app.selectFile(app.editorStore.state, original)).toMatchObject({
      source: 'original source',
      settings: DEFAULT_SETTINGS,
    })
    expect(app.duplicateFile(original)).toBeTruthy()
    expect(
      new Set(app.editorStore.state.files.map((file) => file.fileName)).size,
    ).toBe(3)
  })

  it('syncs zoom only across open files and forgets a closed preview', async () => {
    const app = await load()
    const first = app.editorStore.state.openFileIds[0]
    const second = app.addFile()!
    const closed = app.addFile()!
    app.closeFile(closed)
    app.setSyncZoom(true)
    app.setPreviewZoom(first, 2)
    expect(app.zoomStore.state).toEqual({ [first]: 2, [second]: 2 })
    app.closeFile(second)
    expect(app.zoomStore.state[second]).toBeUndefined()
  })
})

describe('migration and browser storage', () => {
  it('migrates every v2 panel into files and removes old cache copies only after saving', async () => {
    const panels = Array.from({ length: 5 }, (_, index) => ({
      id: `old-${index}`,
      source: `label ${index}`,
      settings: DEFAULT_SETTINGS,
      fileName: `Shipping-${index}`,
    }))
    saved.set(
      'zpl-editor:v2',
      JSON.stringify({ panels, explain: false, syncZoom: true }),
    )
    saved.set('zpl-editor:v1', JSON.stringify(panels[0]))
    const app = await load()
    expect(app.editorStore.state.files).toEqual(panels)
    expect(app.editorStore.state.openFileIds).toEqual(
      panels.slice(0, 4).map((file) => file.id),
    )
    expect(app.editorStore.state).toMatchObject({
      explain: false,
      syncZoom: true,
    })
    expect(saved.has('zpl-editor:v2')).toBe(false)
    expect(saved.has('zpl-editor:v1')).toBe(false)
    app.deleteFile('old-0')
    expect([...saved.values()].join('')).not.toContain('label 0')
  })

  it('migrates the single-file v1 cache with source and settings intact', async () => {
    saved.set(
      'zpl-editor:v1',
      JSON.stringify({
        source: 'legacy label',
        settings: { dpmm: 12, widthIn: 2, heightIn: 3 },
      }),
    )
    const app = await load()
    expect(app.editorStore.state.files).toMatchObject([
      {
        source: 'legacy label',
        settings: { dpmm: 12, widthIn: 2, heightIn: 3 },
        fileName: 'label',
      },
    ])
    expect(app.editorStore.state.openFileIds).toHaveLength(1)
  })

  it('repairs stale references, duplicate IDs, and invalid settings without dropping sources', async () => {
    saved.set(
      STORAGE_KEY,
      JSON.stringify({
        files: [
          {
            id: 'same',
            source: 'one',
            settings: { widthIn: -3, heightIn: 999, dpmm: 999 },
          },
          { id: 'same', source: 'two' },
        ],
        openFileIds: ['same', 'missing', 'same'],
        activeFileId: 'missing',
      }),
    )
    const app = await load()
    expect(
      new Set(app.editorStore.state.files.map((file) => file.id)).size,
    ).toBe(2)
    expect(app.editorStore.state.files.map((file) => file.source)).toEqual([
      'one',
      'two',
    ])
    expect(app.editorStore.state.openFileIds).toEqual(['same'])
    expect(app.editorStore.state.activeFileId).toBe('same')
    expect(app.editorStore.state.files[0].settings).toEqual({
      ...DEFAULT_SETTINGS,
      heightIn: 30,
    })
  })

  it('handles malformed JSON and unavailable storage without breaking editing', async () => {
    saved.set(STORAGE_KEY, '{broken')
    storage.setItem.mockImplementation(() => {
      throw new Error('Quota exceeded')
    })
    const app = await load()
    const id = app.editorStore.state.openFileIds[0]
    expect(() => app.setSource(id, 'in memory')).not.toThrow()
    expect(app.selectFile(app.editorStore.state, id)?.source).toBe('in memory')
    expect(app.storageStatusStore.state).toBe('unavailable')
  })

  it('retains legacy data if saving the migration fails and recovers on the next successful save', async () => {
    saved.set(
      'zpl-editor:v2',
      JSON.stringify({ panels: [{ id: 'legacy', source: 'precious label' }] }),
    )
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('Quota exceeded')
    })
    const app = await load()
    expect(saved.has('zpl-editor:v2')).toBe(true)
    expect(app.storageStatusStore.state).toBe('unavailable')
    app.setFileName('legacy', 'Shipping')
    expect(app.storageStatusStore.state).toBe('saved')
    expect(saved.has('zpl-editor:v2')).toBe(false)
    expect(JSON.parse(saved.get(STORAGE_KEY)!).files[0]).toMatchObject({
      source: 'precious label',
      fileName: 'Shipping',
    })
  })
})

describe('shared files', () => {
  it('opens a shared file at capacity while retaining the displaced tab in the library', async () => {
    const app = await load()
    for (let i = 1; i < app.MAX_PANELS; i++) app.addFile()
    const before = app.editorStore.state
    const displaced = before.openFileIds.at(-1)!
    app.setSource(displaced, 'saved displaced source')
    app.openSharedLabel('shared source', DEFAULT_SETTINGS)
    expect(app.editorStore.state.openFileIds).toHaveLength(4)
    expect(app.editorStore.state.openFileIds).not.toContain(displaced)
    expect(app.selectFile(app.editorStore.state, displaced)?.source).toBe(
      'saved displaced source',
    )
    expect(app.editorStore.state.files).toHaveLength(5)
    expect(
      app.selectFile(app.editorStore.state, app.editorStore.state.activeFileId!)
        ?.source,
    ).toBe('shared source')
  })

  it('reopens a matching closed file instead of creating another copy', async () => {
    const app = await load()
    const first = app.editorStore.state.openFileIds[0]
    app.setSource(first, 'shared source')
    app.closeFile(first)
    app.openSharedLabel('shared source', DEFAULT_SETTINGS)
    expect(app.editorStore.state.files).toHaveLength(1)
    expect(app.editorStore.state.openFileIds).toEqual([first])
    expect(app.editorStore.state.activeFileId).toBe(first)
  })
})

describe('disk files', () => {
  it('opens a disk file under its own name in place of the sample', async () => {
    const app = await load()
    app.addFile()
    const id = app.openDiskFile('^XA^XZ', 'label.zpl')
    const file = app.selectFile(app.editorStore.state, id)
    expect(file).toMatchObject({
      source: '^XA^XZ',
      fileName: 'label',
      disk: true,
    })
    expect(app.editorStore.state.openFileIds[0]).toBe(id)
    expect(app.editorStore.state.activeFileId).toBe(id)
  })

  it('remembers which files live on disk across reloads', async () => {
    const app = await load()
    const id = app.openDiskFile('^XA^XZ', 'shipping.txt')
    const reloaded = await reload()
    expect(reloaded.selectFile(reloaded.editorStore.state, id)).toMatchObject({
      fileName: 'shipping',
      disk: true,
    })
  })
})
