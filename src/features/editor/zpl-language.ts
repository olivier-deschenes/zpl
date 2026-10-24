import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language'
import { Annotation, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, hoverTooltip } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { getCommandCapability } from 'zplr/web'
import type { CommandCapabilityStatus } from 'zplr/web'

import { m } from '#/paraglide/messages'

interface ZplTokenState {
  /** Inside ^FD/^FV field data or a ^FX comment, which run until the next command. */
  body: 'data' | 'comment' | null
}

const zplStreamLanguage = StreamLanguage.define<ZplTokenState>({
  name: 'zpl',
  startState: () => ({ body: null }),
  token(stream, state) {
    if (stream.eatSpace()) return null

    const next = stream.peek()
    if (next === '^' || next === '~') {
      stream.next()
      // Every command is a prefix plus two characters (^FO, ^A0, ~DG, …).
      const code = (stream.next() ?? '') + (stream.next() ?? '')
      const upper = code.toUpperCase()
      state.body =
        upper === 'FD' || upper === 'FV'
          ? 'data'
          : upper === 'FX'
            ? 'comment'
            : null
      return 'keyword'
    }

    stream.eatWhile((char) => char !== '^' && char !== '~')
    if (state.body === 'data') return 'string'
    if (state.body === 'comment') return 'comment'
    return 'number'
  },
})

const zplHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--foreground)', fontWeight: '600' },
  { tag: tags.number, color: 'var(--muted-foreground)' },
  { tag: tags.string, color: 'var(--syntax-data)' },
  { tag: tags.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
])

const STATUS_LABEL: Record<CommandCapabilityStatus, () => string> = {
  supported: m.command_supported,
  partial: m.command_partial,
  'non-rendering': m.command_non_rendering,
  unsupported: m.command_unsupported,
  unknown: m.command_unknown,
}

/** Shows the command's name and preview support when hovering ^XX / ~XX. */
const commandTooltip = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos)
  const column = pos - line.from

  for (const match of line.text.matchAll(/[\^~][A-Za-z0-9@]{1,2}/g)) {
    const start = match.index
    const end = start + match[0].length
    if (column < start || column > end) continue

    const token = match[0].toUpperCase()
    // ^A0 is font command ^A with font name 0; most others are two letters.
    const capability =
      getCommandCapability(token) ?? getCommandCapability(token.slice(0, 2))
    const canonical = capability?.canonical ?? token

    return {
      pos: line.from + start,
      end: line.from + end,
      above: true,
      create() {
        const dom = document.createElement('div')
        dom.className = 'cm-zpl-command-tooltip'
        const title = document.createElement('strong')
        title.textContent = capability
          ? `${canonical} ${capability.name}`
          : canonical
        const status = document.createElement('span')
        status.textContent = STATUS_LABEL[capability?.status ?? 'unknown']()
        dom.append(title, status)
        return { dom }
      },
    }
  }
  return null
})

/** Marks transactions dispatched because a field was clicked in the preview. */
export const fromPreview = Annotation.define<boolean>()

export const setHighlight = StateEffect.define<{
  from: number
  to: number
} | null>()

const highlightMark = Decoration.mark({ class: 'cm-zpl-highlight' })

/** The source span of the field last clicked in the preview. */
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(highlight, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHighlight)) {
        const range = effect.value
        return range && range.to > range.from
          ? Decoration.set(highlightMark.range(range.from, range.to))
          : Decoration.none
      }
    }
    // Moving the cursor yourself dismisses the highlight.
    if (tr.selection && !tr.annotation(fromPreview)) return Decoration.none
    return highlight.map(tr.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

const MONO_FONT = "'Geist Mono Variable', ui-monospace, monospace"
const SANS_FONT = "'Geist Variable', ui-sans-serif, system-ui, sans-serif"

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    color: 'var(--foreground)',
    backgroundColor: 'var(--background)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: MONO_FONT,
    lineHeight: '1.6',
    overscrollBehavior: 'none',
  },
  '.cm-content': { caretColor: 'var(--foreground)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-gutters': {
    color: 'var(--muted-foreground)',
    backgroundColor: 'var(--background)',
    border: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in oklch, var(--muted) 70%, transparent)',
  },
  '.cm-activeLineGutter': {
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'var(--selection-soft)' },
  '.cm-zpl-highlight': {
    backgroundColor: 'var(--selection-soft)',
    outline: '1px solid var(--selection)',
  },
  '.cm-tooltip': {
    color: 'var(--popover-foreground)',
    backgroundColor: 'var(--popover)',
    border: '1px solid var(--border)',
    fontFamily: SANS_FONT,
    fontSize: '12px',
  },
  '.cm-zpl-command-tooltip': {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '6px 8px',
  },
  '.cm-zpl-command-tooltip span': { color: 'var(--muted-foreground)' },
  '.cm-tooltip-lint': { padding: '0' },
  '.cm-diagnostic': { padding: '6px 8px' },
})

export function zpl(): Extension {
  return [
    zplStreamLanguage,
    syntaxHighlighting(zplHighlightStyle),
    commandTooltip,
    highlightField,
    editorTheme,
  ]
}
