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

/** One editor and preview pair, shown side by side with the others. */
export interface Panel {
  id: string
  source: string
  settings: LabelSettings
  /** The name last used to download this panel, without an extension. */
  fileName?: string
}

/** Which renderer draws the preview when not comparing. */
export type PreviewSource = 'local' | 'labelary'

export interface EditorState {
  panels: Panel[]
  previewSource: PreviewSource
  /**
   * Keyed by panel id. Kept apart from `panels` because it changes on every
   * cursor move and is never saved.
   */
  selections: Partial<Record<string, SourceSelection | null>>
}

export const MAX_PANELS = 4

const STORAGE_KEY = 'zpl-editor:v2'
/** Single-label state saved before there were panels. */
const LEGACY_STORAGE_KEY = 'zpl-editor:v1'

export const editorStore = createStore<EditorState>({
  ...loadPersisted(),
  selections: {},
})

let persisted = editorStore.state

editorStore.subscribe((state) => {
  // Selection changes on every cursor move; only write when the rest does.
  const { panels, previewSource } = state
  if (
    panels === persisted.panels &&
    previewSource === persisted.previewSource
  ) {
    return
  }
  persisted = state
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ panels, previewSource }))
  } catch {
    // Storage can be full or blocked (private mode); the editor still works.
  }
})

export function selectPanel(state: EditorState, id: string): Panel | undefined {
  return state.panels.find((panel) => panel.id === id)
}

export function setSource(id: string, source: string) {
  updatePanel(id, (panel) =>
    panel.source === source ? panel : { ...panel, source },
  )
}

export function setSettings(id: string, settings: Partial<LabelSettings>) {
  updatePanel(id, (panel) => ({
    ...panel,
    settings: { ...panel.settings, ...settings },
  }))
}

export function setFileName(id: string, fileName: string) {
  updatePanel(id, (panel) =>
    panel.fileName === fileName ? panel : { ...panel, fileName },
  )
}

export function setPreviewSource(previewSource: PreviewSource) {
  editorStore.setState((state) =>
    state.previewSource === previewSource ? state : { ...state, previewSource },
  )
}

export function setSelection(id: string, selection: SourceSelection | null) {
  editorStore.setState((state) =>
    // Preview clicks always go through, so clicking the same field again
    // scrolls the editor back to it.
    selection?.origin !== 'preview' &&
    sameSelection(state.selections[id] ?? null, selection)
      ? state
      : { ...state, selections: { ...state.selections, [id]: selection } },
  )
}

/** Adds an empty panel at the end, sized like the last one. */
export function addPanel(): string | undefined {
  const last = editorStore.state.panels.at(-1)
  const panel = createPanel('', last?.settings ?? DEFAULT_SETTINGS)
  return insertPanel(panel, editorStore.state.panels.length)
}

/** Copies a panel's source and settings into a new panel right after it. */
export function duplicatePanel(id: string): string | undefined {
  const { panels } = editorStore.state
  const index = panels.findIndex((panel) => panel.id === id)
  if (index === -1) return undefined
  const { source, settings } = panels[index]
  return insertPanel(createPanel(source, settings), index + 1)
}

/** Returns the panel's id, or nothing when there is no room for it. */
export function insertPanel(panel: Panel, index: number): string | undefined {
  if (editorStore.state.panels.length >= MAX_PANELS) return undefined
  editorStore.setState((state) => ({
    ...state,
    panels: [
      ...state.panels.slice(0, index),
      panel,
      ...state.panels.slice(index),
    ],
  }))
  return panel.id
}

/**
 * Removes a panel unless it is the last one. Returns it with its position so
 * it can be put back with `insertPanel`.
 */
export function removePanel(id: string) {
  const { panels } = editorStore.state
  const index = panels.findIndex((panel) => panel.id === id)
  if (index === -1 || panels.length === 1) return undefined

  const panel = panels[index]
  editorStore.setState((state) => {
    const { [id]: _removed, ...selections } = state.selections
    return {
      ...state,
      panels: state.panels.filter((item) => item.id !== id),
      selections,
    }
  })
  return { panel, index }
}

function updatePanel(id: string, update: (panel: Panel) => Panel) {
  editorStore.setState((state) => {
    const current = selectPanel(state, id)
    if (!current) return state
    const next = update(current)
    if (next === current) return state
    return {
      ...state,
      panels: state.panels.map((panel) => (panel === current ? next : panel)),
    }
  })
}

function createPanel(source: string, settings: LabelSettings): Panel {
  return { id: createPanelId(), source, settings }
}

function createPanelId() {
  // crypto.randomUUID needs a secure context, which a LAN preview isn't.
  return Math.random().toString(36).slice(2, 10)
}

function sameSelection(a: SourceSelection | null, b: SourceSelection | null) {
  if (a === null || b === null) return a === b
  return a.from === b.from && a.to === b.to && a.origin === b.origin
}

function loadPersisted(): Pick<EditorState, 'panels' | 'previewSource'> {
  const fallback = {
    panels: [createPanel(SAMPLE_LABEL, DEFAULT_SETTINGS)],
    previewSource: 'local' as const,
  }
  if (typeof localStorage === 'undefined') return fallback

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const { panels, previewSource } = JSON.parse(raw) as {
        panels?: unknown
        previewSource?: unknown
      }
      return {
        panels:
          Array.isArray(panels) && panels.length > 0
            ? panels
                .slice(0, MAX_PANELS)
                .map((panel: Partial<Panel> | null) => sanitizePanel(panel))
            : fallback.panels,
        previewSource: previewSource === 'labelary' ? 'labelary' : 'local',
      }
    }

    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    return legacy
      ? { ...fallback, panels: [sanitizePanel(JSON.parse(legacy))] }
      : fallback
  } catch {
    return fallback
  }
}

function sanitizePanel(value: Partial<Panel> | null): Panel {
  return {
    id: typeof value?.id === 'string' && value.id ? value.id : createPanelId(),
    source: typeof value?.source === 'string' ? value.source : SAMPLE_LABEL,
    settings: sanitizeSettings(value?.settings),
    fileName:
      typeof value?.fileName === 'string' && value.fileName
        ? value.fileName
        : undefined,
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
