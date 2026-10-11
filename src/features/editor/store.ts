import { createStore } from '@tanstack/react-store'

import { DEFAULT_SETTINGS, DENSITIES } from '#/lib/zpl/render'
import type { LabelSettings } from '#/lib/zpl/render'
import { SAMPLE_LABEL } from './sample-label'

export interface SourceSelection {
  from: number
  to: number
  /** Which side made the selection, so the other side knows to follow it. */
  origin: 'editor' | 'preview'
}

export interface EditorState {
  source: string
  settings: LabelSettings
  selection: SourceSelection | null
}

const STORAGE_KEY = 'zpl-editor:v1'

export const editorStore = createStore<EditorState>({
  ...loadPersisted(),
  selection: null,
})

let persisted: Pick<EditorState, 'source' | 'settings'> = editorStore.state

editorStore.subscribe(({ source, settings }) => {
  // Selection changes on every cursor move; only write when content changes.
  if (source === persisted.source && settings === persisted.settings) return
  persisted = { source, settings }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ source, settings }))
  } catch {
    // Storage can be full or blocked (private mode); the editor still works.
  }
})

export function setSource(source: string) {
  editorStore.setState((state) =>
    state.source === source ? state : { ...state, source },
  )
}

export function setSettings(settings: Partial<LabelSettings>) {
  editorStore.setState((state) => ({
    ...state,
    settings: { ...state.settings, ...settings },
  }))
}

export function setSelection(selection: SourceSelection | null) {
  editorStore.setState((state) =>
    // Preview clicks always go through, so clicking the same field again
    // scrolls the editor back to it.
    selection?.origin !== 'preview' && sameSelection(state.selection, selection)
      ? state
      : { ...state, selection },
  )
}

function sameSelection(a: SourceSelection | null, b: SourceSelection | null) {
  if (a === null || b === null) return a === b
  return a.from === b.from && a.to === b.to && a.origin === b.origin
}

function loadPersisted(): Pick<EditorState, 'source' | 'settings'> {
  const fallback = { source: SAMPLE_LABEL, settings: DEFAULT_SETTINGS }
  if (typeof localStorage === 'undefined') return fallback

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<EditorState>
    return {
      source: typeof parsed.source === 'string' ? parsed.source : SAMPLE_LABEL,
      settings: sanitizeSettings(parsed.settings),
    }
  } catch {
    return fallback
  }
}

function sanitizeSettings(
  value: Partial<LabelSettings> | undefined,
): LabelSettings {
  const dpmm =
    DENSITIES.find((density) => density.dpmm === value?.dpmm)?.dpmm ??
    DEFAULT_SETTINGS.dpmm
  const size = (n: unknown, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback

  return {
    dpmm,
    widthIn: size(value?.widthIn, DEFAULT_SETTINGS.widthIn),
    heightIn: size(value?.heightIn, DEFAULT_SETTINGS.heightIn),
  }
}
