import { createStore } from '@tanstack/react-store'

import {
  DEFAULT_SETTINGS,
  DENSITIES,
  MAX_SIZE_IN,
  MIN_SIZE_IN,
} from '#/lib/zpl/settings'
import type { LabelSettings } from '#/lib/zpl/settings'
import { SAMPLE_LABEL } from './sample-label'

/** One editor and preview pair, shown side by side with the others. */
export interface Panel {
  id: string
  source: string
  settings: LabelSettings
  /** The name last used to download this panel, without an extension. */
  fileName?: string
}

export interface EditorState {
  panels: Panel[]
  /** Show plain-language notes beside the code. */
  explain: boolean
}

export const MAX_PANELS = 4

const STORAGE_KEY = 'zpl-editor:v2'
/** Single-label state saved before there were panels. */
const LEGACY_STORAGE_KEY = 'zpl-editor:v1'

export const editorStore = createStore<EditorState>(loadPersisted())

let persisted = editorStore.state

editorStore.subscribe((state) => {
  if (state === persisted) return
  persisted = state
  try {
    const { panels, explain } = state
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ panels, explain }))
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

export function setExplain(explain: boolean) {
  editorStore.setState((state) =>
    state.explain === explain ? state : { ...state, explain },
  )
}

/** Adds an empty panel right after another one, sized like it. */
export function addPanel(afterId: string): string | undefined {
  const { panels } = editorStore.state
  const index = panels.findIndex((panel) => panel.id === afterId)
  if (index === -1) return undefined
  const panel = createPanel('', panels[index].settings)
  return insertPanel(panel, index + 1)
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

/** Removes a panel unless it is the last one. */
export function removePanel(id: string) {
  const { panels } = editorStore.state
  if (panels.length === 1 || !selectPanel(editorStore.state, id)) return

  editorStore.setState((state) => ({
    ...state,
    panels: state.panels.filter((item) => item.id !== id),
  }))
}

/**
 * Opens a label from a share link as the first panel, where it is in view
 * even on a phone. It takes the place of an untouched sample, and closes
 * the last panel when every slot is taken.
 */
export function openSharedLabel(
  source: string,
  settings: Partial<Record<keyof LabelSettings, unknown>>,
) {
  const shared = createPanel(source, sanitizeSettings(settings))
  const { panels } = editorStore.state
  if (
    panels.some(
      (panel) =>
        panel.source === source &&
        sameSettings(panel.settings, shared.settings),
    )
  ) {
    return
  }

  const replacedSample = panels.length === 1 && isUntouched(panels[0])
  const kept = replacedSample ? [] : panels.slice(0, MAX_PANELS - 1)

  editorStore.setState((state) => ({
    ...state,
    panels: [shared, ...kept],
  }))
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

function sameSettings(a: LabelSettings, b: LabelSettings) {
  return (
    a.dpmm === b.dpmm && a.widthIn === b.widthIn && a.heightIn === b.heightIn
  )
}

/** Still the first-visit sample, or empty: nothing to lose by replacing it. */
function isUntouched(panel: Panel) {
  return panel.source === SAMPLE_LABEL || panel.source.trim() === ''
}

function loadPersisted(): EditorState {
  const fallback = {
    panels: [createPanel(SAMPLE_LABEL, DEFAULT_SETTINGS)],
    explain: true,
  }
  if (typeof localStorage === 'undefined') return fallback

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const { panels, explain } = JSON.parse(raw) as {
        panels?: unknown
        explain?: unknown
      }
      return {
        panels:
          Array.isArray(panels) && panels.length > 0
            ? panels
                .slice(0, MAX_PANELS)
                .map((panel: Partial<Panel> | null) => sanitizePanel(panel))
            : fallback.panels,
        explain: typeof explain === 'boolean' ? explain : fallback.explain,
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

/** Settings from storage or a share link, which may be stale or hand-edited. */
function sanitizeSettings(
  value: Partial<Record<keyof LabelSettings, unknown>> | undefined,
): LabelSettings {
  const dpmm =
    DENSITIES.find((density) => density.dpmm === value?.dpmm)?.dpmm ??
    DEFAULT_SETTINGS.dpmm
  const size = (n: unknown, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n) && n > 0
      ? Math.min(Math.max(n, MIN_SIZE_IN), MAX_SIZE_IN)
      : fallback

  return {
    dpmm,
    widthIn: size(value?.widthIn, DEFAULT_SETTINGS.widthIn),
    heightIn: size(value?.heightIn, DEFAULT_SETTINGS.heightIn),
  }
}
