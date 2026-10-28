import { Debouncer } from '@tanstack/react-pacer'
import { createStore } from '@tanstack/react-store'

import { editorStore, openDiskFile, openFile, setSource } from './store'
import type { EditorState } from './store'

/**
 * Files opened from disk stay linked to it through the File System Access
 * API: edits are written back, and changes made by other programs reload.
 * Only Chromium browsers implement it.
 */
export type DiskStatus =
  /** Reading the file or asking whether it may still be used. */
  | 'connecting'
  | 'synced'
  /** The browser forgot its permission, usually after a reload. */
  | 'permission'
  /** The file was moved, renamed or deleted on disk. */
  | 'missing'
  | 'error'

export const diskStatusStore = createStore<Record<string, DiskStatus>>({})

/** How often linked files are checked for changes made outside the app. */
const POLL_MS = 1000
const WRITE_DELAY_MS = 300
const DB_NAME = 'zpl-editor-disk'
const HANDLES = 'handles'

interface PermissionHandle extends FileSystemFileHandle {
  queryPermission: (options: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission: (options: {
    mode: 'readwrite'
  }) => Promise<PermissionState>
}

interface FilePickerWindow {
  showOpenFilePicker: (options: {
    id?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<PermissionHandle[]>
}

interface Link {
  handle: PermissionHandle
  /** The text last read from or written to disk. */
  text: string
  lastModified: number
  writer: Debouncer<() => void>
  busy: boolean
}

const links = new Map<string, Link>()
let started = false

export function canOpenFromDisk() {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window
}

/**
 * Asks for a file and opens it linked to disk. Opening the same file again
 * focuses its existing tab. With `relinkId`, the chosen file replaces that
 * file's lost link instead.
 */
export async function openFromDisk(relinkId?: string): Promise<void> {
  const picker = window as unknown as FilePickerWindow
  let handle: PermissionHandle
  try {
    ;[handle] = await picker.showOpenFilePicker({
      id: 'zpl',
      types: [
        {
          description: 'ZPL',
          accept: { 'text/plain': ['.zpl', '.txt', '.prn'] },
        },
      ],
    })
  } catch {
    return // Cancelled.
  }

  if (relinkId) {
    setStatus(relinkId, 'connecting')
    const permission = await handle
      .requestPermission({ mode: 'readwrite' })
      .catch(() => 'denied' as const)
    await writeHandle(relinkId, handle)
    if (permission === 'granted') await connect(relinkId, handle)
    else setStatus(relinkId, 'permission')
    return
  }

  for (const [id, entry] of links) {
    if (await entry.handle.isSameEntry(handle)) {
      openFile(id)
      return
    }
  }
  const stored = await readHandles()
  for (const [id, other] of stored) {
    if (await other.isSameEntry(handle)) {
      openFile(id)
      await reconnectDiskFile(id)
      return
    }
  }

  // Picking grants read access; writing back needs its own permission.
  const permission = await handle
    .requestPermission({ mode: 'readwrite' })
    .catch(() => 'denied' as const)
  const file = await handle.getFile()
  const text = await file.text()
  const id = openDiskFile(text, handle.name)
  await writeHandle(id, handle)
  if (permission === 'granted') link(id, handle, text, file.lastModified)
  else setStatus(id, 'permission')
}

/** Must run from a click: the browser asks before granting access again. */
export async function reconnectDiskFile(id: string): Promise<void> {
  const handle = (await readHandles()).get(id)
  if (!handle) return setStatus(id, 'missing')
  setStatus(id, 'connecting')
  const permission = await handle
    .requestPermission({ mode: 'readwrite' })
    .catch(() => 'denied' as const)
  if (permission !== 'granted') return setStatus(id, 'permission')
  await connect(id, handle)
}

/**
 * Writes a file's pending edits to disk now instead of after the debounce.
 * A file whose permission was lost asks for it again, so call this from a
 * user gesture such as a key press.
 */
export async function saveDiskFile(id: string): Promise<void> {
  const entry = links.get(id)
  if (entry) return entry.writer.flush()
  const status = diskStatusStore.state[id]
  if (status === 'permission' || status === 'error') {
    await reconnectDiskFile(id)
  }
}

/** Links the disk files saved in the library; call once in the browser. */
export function startDiskSync() {
  if (started || !canOpenFromDisk()) return
  started = true

  editorStore.subscribe(onEditorChange)
  setInterval(() => {
    if (!document.hidden) void pollAll()
  }, POLL_MS)
  // Pick up edits made in another program as soon as the user is back.
  window.addEventListener('focus', () => void pollAll())

  void readHandles().then(async (handles) => {
    for (const file of editorStore.state.files) {
      if (!file.disk) continue
      const handle = handles.get(file.id)
      if (!handle) {
        setStatus(file.id, 'missing')
        continue
      }
      setStatus(file.id, 'connecting')
      const permission = await handle
        .queryPermission({ mode: 'readwrite' })
        .catch(() => 'denied' as const)
      if (permission === 'granted') await connect(file.id, handle)
      else setStatus(file.id, 'permission')
    }
  })
}

/** Reads the disk's version, which wins over the copy kept in the browser. */
async function connect(id: string, handle: PermissionHandle) {
  try {
    const file = await handle.getFile()
    const text = await file.text()
    setSource(id, text)
    link(id, handle, text, file.lastModified)
  } catch (error) {
    setStatus(id, failure(error))
  }
}

function link(
  id: string,
  handle: PermissionHandle,
  text: string,
  lastModified: number,
) {
  links.get(id)?.writer.cancel()
  const entry: Link = {
    handle,
    text,
    lastModified,
    busy: false,
    writer: new Debouncer(
      () => {
        void write(id)
      },
      { wait: WRITE_DELAY_MS },
    ),
  }
  links.set(id, entry)
  setStatus(id, 'synced')
}

function onEditorChange(state: EditorState) {
  for (const [id, entry] of links) {
    const file = state.files.find((candidate) => candidate.id === id)
    if (!file) {
      // Deleted from the library; the file on disk is left alone.
      entry.writer.cancel()
      links.delete(id)
      forget(id)
      void deleteHandle(id)
    } else if (file.source !== entry.text) {
      entry.writer.maybeExecute()
    }
  }
  for (const id of Object.keys(diskStatusStore.state)) {
    if (!links.has(id) && !state.files.some((file) => file.id === id)) {
      forget(id)
      void deleteHandle(id)
    }
  }
}

async function write(id: string) {
  const entry = links.get(id)
  const source = editorStore.state.files.find((file) => file.id === id)?.source
  if (!entry || source === undefined || source === entry.text) return
  if (entry.busy) return entry.writer.maybeExecute()
  entry.busy = true
  try {
    const stream = await entry.handle.createWritable()
    await stream.write(source)
    await stream.close()
    entry.text = source
    entry.lastModified = (await entry.handle.getFile()).lastModified
    setStatus(id, 'synced')
  } catch (error) {
    setStatus(id, failure(error))
  } finally {
    entry.busy = false
  }
}

async function pollAll() {
  await Promise.all([...links.keys()].map(poll))
}

async function poll(id: string) {
  const entry = links.get(id)
  if (!entry || entry.busy) return
  entry.busy = true
  try {
    const file = await entry.handle.getFile()
    if (file.lastModified !== entry.lastModified) {
      const text = await file.text()
      entry.lastModified = file.lastModified
      if (text !== entry.text) {
        // The disk changed; it replaces any edit still waiting to be written.
        entry.writer.cancel()
        entry.text = text
        setSource(id, text)
      }
    }
    setStatus(id, 'synced')
  } catch (error) {
    setStatus(id, failure(error))
  } finally {
    entry.busy = false
  }
}

function failure(error: unknown): DiskStatus {
  if (error instanceof DOMException) {
    if (error.name === 'NotFoundError') return 'missing'
    if (error.name === 'NotAllowedError') return 'permission'
  }
  return 'error'
}

function setStatus(id: string, status: DiskStatus) {
  if (status !== 'synced' && status !== 'connecting') {
    links.get(id)?.writer.cancel()
    links.delete(id)
  }
  diskStatusStore.setState((current) =>
    current[id] === status ? current : { ...current, [id]: status },
  )
}

function forget(id: string) {
  diskStatusStore.setState((current) => {
    if (!(id in current)) return current
    const next = { ...current }
    delete next[id]
    return next
  })
}

// File handles can't go in localStorage, but IndexedDB keeps them.
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(HANDLES)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, done: (value: T) => void) => IDBRequest,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(
        db.transaction(HANDLES, mode).objectStore(HANDLES),
        resolve,
      )
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

async function readHandles(): Promise<Map<string, PermissionHandle>> {
  try {
    return await transaction('readonly', (store, done) => {
      const handles = new Map<string, PermissionHandle>()
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return done(handles)
        handles.set(String(cursor.key), cursor.value as PermissionHandle)
        cursor.continue()
      }
      return request
    })
  } catch {
    return new Map()
  }
}

function writeHandle(id: string, handle: PermissionHandle) {
  return changeHandles((store) => store.put(handle, id))
}

function deleteHandle(id: string) {
  return changeHandles((store) => store.delete(id))
}

function changeHandles(run: (store: IDBObjectStore) => IDBRequest) {
  return transaction<void>('readwrite', (store, done) => {
    const request = run(store)
    request.onsuccess = () => done()
    return request
  }).catch(() => undefined)
}
