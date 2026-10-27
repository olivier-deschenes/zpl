import { createStore } from '@tanstack/react-store'

import { DEFAULT_FILE_NAME, toFileBaseName } from '#/lib/zpl/export'
import {
  DEFAULT_SETTINGS,
  DENSITIES,
  MAX_SIZE_IN,
  MIN_SIZE_IN,
} from '#/lib/zpl/settings'
import type { LabelSettings } from '#/lib/zpl/settings'
import { SAMPLE_LABEL } from './sample-label'

/** A saved file exists independently of its open editor and preview. */
export interface EditorFile {
  id: string
  source: string
  settings: LabelSettings
  /** The file's name, without the .zpl extension. */
  fileName: string
  /** Kept in sync with a file on disk instead of living only in the browser. */
  disk?: true
}

export interface EditorState {
  files: EditorFile[]
  openFileIds: string[]
  activeFileId: string | null
  explain: boolean
  syncZoom: boolean
}

export type PreviewZoom = number | 'fit'
/** The number of simultaneous previews, not the number of saved files. */
export const MAX_PANELS = 4
const STORAGE_KEY = 'zpl-editor:v3'
const PREVIOUS_STORAGE_KEY = 'zpl-editor:v2'
const LEGACY_STORAGE_KEY = 'zpl-editor:v1'

export const editorStore = createStore<EditorState>(loadPersisted())
export const storageStatusStore = createStore<'saved' | 'unavailable'>('saved')
/** Preview gestures don't write the file library to storage every frame. */
export const zoomStore = createStore<Record<string, PreviewZoom | undefined>>(
  {},
)

editorStore.subscribe(persist)
// Commit migrations before removing their old keys, even without an edit.
persist(editorStore.state)

function persist(state: EditorState) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    // A deleted file must not survive in an older cache or reappear on reload.
    localStorage.removeItem(PREVIOUS_STORAGE_KEY)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    storageStatusStore.setState(() => 'saved')
  } catch {
    storageStatusStore.setState(() => 'unavailable')
  }
}

export function selectFile(
  state: EditorState,
  id: string,
): EditorFile | undefined {
  return state.files.find((file) => file.id === id)
}

export function setSource(id: string, source: string) {
  updateFile(id, (file) =>
    file.source === source ? file : { ...file, source },
  )
}

export function setSettings(id: string, settings: Partial<LabelSettings>) {
  updateFile(id, (file) => ({
    ...file,
    settings: { ...file.settings, ...settings },
  }))
}

export function setFileName(id: string, name: string) {
  const fileName = toFileBaseName(name, 'zpl')
  if (!fileName) return
  updateFile(id, (file) =>
    file.fileName === fileName ? file : { ...file, fileName },
  )
}

export function setActiveFile(id: string) {
  editorStore.setState((state) =>
    state.activeFileId === id || !state.openFileIds.includes(id)
      ? state
      : { ...state, activeFileId: id },
  )
}

export function setExplain(explain: boolean) {
  editorStore.setState((state) =>
    state.explain === explain ? state : { ...state, explain },
  )
}

export function setSyncZoom(syncZoom: boolean) {
  editorStore.setState((state) =>
    state.syncZoom === syncZoom ? state : { ...state, syncZoom },
  )
  if (syncZoom) zoomStore.setState(() => ({}))
}

export function setPreviewZoom(id: string, zoom: PreviewZoom) {
  const { openFileIds, syncZoom } = editorStore.state
  const ids = syncZoom ? openFileIds : [id]
  zoomStore.setState((zooms) => ({
    ...zooms,
    ...Object.fromEntries(ids.map((fileId) => [fileId, zoom])),
  }))
}

/** Creates a saved file, using the active file's label settings. */
export function addFile(): string | undefined {
  const state = editorStore.state
  if (state.openFileIds.length >= MAX_PANELS) return undefined
  const active = state.activeFileId
    ? selectFile(state, state.activeFileId)
    : undefined
  return insertFile(
    createFile('', active?.settings ?? DEFAULT_SETTINGS),
    state.openFileIds.length,
  )
}

export function duplicateFile(id: string): string | undefined {
  const state = editorStore.state
  const file = selectFile(state, id)
  if (!file || state.openFileIds.length >= MAX_PANELS) return undefined
  const copy = createFile(file.source, file.settings, `${file.fileName}-copy`)
  const index = state.openFileIds.indexOf(id)
  return insertFile(copy, index === -1 ? state.openFileIds.length : index + 1)
}

/** Focuses an open file or reopens a saved one without making a copy. */
export function openFile(id: string): boolean {
  const state = editorStore.state
  if (!selectFile(state, id)) return false
  if (state.openFileIds.includes(id)) {
    setActiveFile(id)
    return true
  }
  if (state.openFileIds.length >= MAX_PANELS) return false
  editorStore.setState((current) => ({
    ...current,
    openFileIds: [...current.openFileIds, id],
    activeFileId: id,
  }))
  return true
}

/** Closing a tab never removes its saved source or label settings. */
export function closeFile(id: string) {
  editorStore.setState((state) => {
    if (!state.openFileIds.includes(id)) return state
    return { ...state, ...withoutOpenFile(state, id) }
  })
  forgetZoom(id)
}

/** Called only after the user confirms deletion. */
export function deleteFile(id: string) {
  editorStore.setState((state) => {
    if (!selectFile(state, id)) return state
    return {
      ...state,
      ...withoutOpenFile(state, id),
      files: state.files.filter((file) => file.id !== id),
    }
  })
  forgetZoom(id)
}

/** Shared labels may displace a tab, but never delete the displaced file. */
export function openSharedLabel(
  source: string,
  settings: Partial<Record<keyof LabelSettings, unknown>>,
) {
  const cleanSettings = sanitizeSettings(settings)
  const existing = editorStore.state.files.find(
    (file) =>
      file.source === source && sameSettings(file.settings, cleanSettings),
  )
  showFirst(existing ?? createFile(source, cleanSettings))
}

/** Adds a file opened from disk, in front of the open tabs. */
export function openDiskFile(source: string, name: string): string {
  const state = editorStore.state
  const active = state.activeFileId
    ? selectFile(state, state.activeFileId)
    : undefined
  const file: EditorFile = {
    ...createFile(source, active?.settings ?? DEFAULT_SETTINGS),
    // The disk's name, even if a browser file already uses it.
    fileName:
      toFileBaseName(name.replace(/\.(txt|prn)$/i, ''), 'zpl') ||
      DEFAULT_FILE_NAME,
    disk: true,
  }
  showFirst(file)
  return file.id
}

/** Shows `file` as the first tab, displacing a tab only when all are used. */
function showFirst(file: EditorFile) {
  const state = editorStore.state
  const existing = selectFile(state, file.id)
  if (existing && state.openFileIds.includes(existing.id)) {
    setActiveFile(existing.id)
    return
  }
  const only =
    state.openFileIds.length === 1
      ? selectFile(state, state.openFileIds[0])
      : undefined
  const kept =
    only && (only.source === SAMPLE_LABEL || only.source.trim() === '')
      ? []
      : state.openFileIds.slice(0, MAX_PANELS - 1)
  editorStore.setState((current) => ({
    ...current,
    files: existing ? current.files : [...current.files, file],
    openFileIds: [file.id, ...kept],
    activeFileId: file.id,
  }))
  for (const id of state.openFileIds) {
    if (!kept.includes(id)) forgetZoom(id)
  }
}

function insertFile(file: EditorFile, index: number): string {
  editorStore.setState((state) => ({
    ...state,
    files: [...state.files, file],
    openFileIds: [
      ...state.openFileIds.slice(0, index),
      file.id,
      ...state.openFileIds.slice(index),
    ],
    activeFileId: file.id,
  }))
  return file.id
}

function withoutOpenFile(state: EditorState, id: string) {
  const index = state.openFileIds.indexOf(id)
  const openFileIds = state.openFileIds.filter((fileId) => fileId !== id)
  return {
    openFileIds,
    activeFileId:
      state.activeFileId === id
        ? (openFileIds[Math.min(index, openFileIds.length - 1)] ?? null)
        : state.activeFileId,
  }
}

function forgetZoom(id: string) {
  zoomStore.setState((zooms) => {
    if (!(id in zooms)) return zooms
    const next = { ...zooms }
    delete next[id]
    return next
  })
}

function updateFile(id: string, update: (file: EditorFile) => EditorFile) {
  editorStore.setState((state) => {
    const current = selectFile(state, id)
    if (!current) return state
    const next = update(current)
    return next === current
      ? state
      : {
          ...state,
          files: state.files.map((file) => (file === current ? next : file)),
        }
  })
}

function createFile(
  source: string,
  settings: LabelSettings,
  name = DEFAULT_FILE_NAME,
): EditorFile {
  return {
    id: createFileId(),
    source,
    settings: { ...settings },
    fileName: availableName(name, editorStore.state.files),
  }
}

function createFileId() {
  // getRandomValues also works on LAN origins without a secure context.
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (word) =>
    word.toString(36),
  ).join('-')
}

function availableName(base: string, files: EditorFile[]) {
  const names = new Set(files.map((file) => file.fileName.toLowerCase()))
  let name = base
  for (let n = 2; names.has(name.toLowerCase()); n++) name = `${base}-${n}`
  return name
}

function sameSettings(a: LabelSettings, b: LabelSettings) {
  return (
    a.dpmm === b.dpmm && a.widthIn === b.widthIn && a.heightIn === b.heightIn
  )
}

function loadPersisted(): EditorState {
  // TanStack still imports this module on the server with ssr: false.
  // Workers prohibit random ID generation during module initialization;
  // the file library and its initial sample belong to the browser only.
  if (typeof window === 'undefined') {
    return {
      files: [],
      openFileIds: [],
      activeFileId: null,
      explain: true,
      syncZoom: false,
    }
  }

  const sample: EditorFile = {
    id: createFileId(),
    source: SAMPLE_LABEL,
    settings: { ...DEFAULT_SETTINGS },
    fileName: DEFAULT_FILE_NAME,
  }
  const fallback: EditorState = {
    files: [sample],
    openFileIds: [sample.id],
    activeFileId: sample.id,
    explain: true,
    syncZoom: false,
  }
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) {
      const saved = record(JSON.parse(raw))
      if (!Array.isArray(saved.files)) return fallback
      const files = sanitizeFiles(saved.files)
      const ids = new Set(files.map((file) => file.id))
      const openFileIds = Array.isArray(saved.openFileIds)
        ? [
            ...new Set(
              saved.openFileIds.filter(
                (id): id is string => typeof id === 'string' && ids.has(id),
              ),
            ),
          ].slice(0, MAX_PANELS)
        : files.slice(0, MAX_PANELS).map((file) => file.id)
      return {
        files,
        openFileIds,
        activeFileId:
          typeof saved.activeFileId === 'string' &&
          openFileIds.includes(saved.activeFileId)
            ? saved.activeFileId
            : (openFileIds[0] ?? null),
        explain: typeof saved.explain === 'boolean' ? saved.explain : true,
        syncZoom: typeof saved.syncZoom === 'boolean' ? saved.syncZoom : false,
      }
    }
    const previous = localStorage.getItem(PREVIOUS_STORAGE_KEY)
    if (previous !== null) {
      const saved = record(JSON.parse(previous))
      if (!Array.isArray(saved.panels) || saved.panels.length === 0)
        return fallback
      const files = sanitizeFiles(saved.panels)
      const openFileIds = files.slice(0, MAX_PANELS).map((file) => file.id)
      return {
        files,
        openFileIds,
        activeFileId: openFileIds[0] ?? null,
        explain: typeof saved.explain === 'boolean' ? saved.explain : true,
        syncZoom: typeof saved.syncZoom === 'boolean' ? saved.syncZoom : false,
      }
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy !== null) {
      const files = sanitizeFiles([JSON.parse(legacy)])
      return {
        ...fallback,
        files,
        openFileIds: [files[0].id],
        activeFileId: files[0].id,
      }
    }
  } catch {
    // Broken or inaccessible storage must not prevent editing.
  }
  return fallback
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

function sanitizeFiles(values: unknown[]): EditorFile[] {
  const files: EditorFile[] = []
  const ids = new Set<string>()
  for (const item of values) {
    const value = record(item)
    const id =
      typeof value.id === 'string' && value.id && !ids.has(value.id)
        ? value.id
        : createFileId()
    ids.add(id)
    const name =
      typeof value.fileName === 'string'
        ? toFileBaseName(value.fileName, 'zpl')
        : ''
    files.push({
      id,
      source: typeof value.source === 'string' ? value.source : '',
      settings: sanitizeSettings(record(value.settings)),
      fileName: name || availableName(DEFAULT_FILE_NAME, files),
      ...(value.disk === true && { disk: true as const }),
    })
  }
  return files
}

function sanitizeSettings(
  value: Partial<Record<keyof LabelSettings, unknown>>,
): LabelSettings {
  const dpmm =
    DENSITIES.find((density) => density.dpmm === value.dpmm)?.dpmm ??
    DEFAULT_SETTINGS.dpmm
  const size = (n: unknown, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n) && n > 0
      ? Math.min(Math.max(n, MIN_SIZE_IN), MAX_SIZE_IN)
      : fallback
  return {
    dpmm,
    widthIn: size(value.widthIn, DEFAULT_SETTINGS.widthIn),
    heightIn: size(value.heightIn, DEFAULT_SETTINGS.heightIn),
  }
}
