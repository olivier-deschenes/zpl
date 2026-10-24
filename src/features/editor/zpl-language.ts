import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language'
import { Annotation, Facet, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  hoverTooltip,
} from '@codemirror/view'
import type { EditorState, Extension, Text } from '@codemirror/state'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { findCommandAtOffset, parseDocument } from 'zplr/web'
import type { CommandCapabilityStatus, ZplDocument } from 'zplr/web'

import {
  explainCommand,
  explainDocument,
  parameterIndexAt,
} from '#/lib/zpl/explain'
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

/** The printer dpi the explanations convert dots to inches with. */
const labelDpi = Facet.define<number, number>({
  combine: (values) => values.at(-1) ?? 203,
})

/** Docs are immutable, so each version is parsed at most once. */
const parsed = new WeakMap<Text, ZplDocument>()

function documentOf(state: EditorState): ZplDocument {
  let document = parsed.get(state.doc)
  if (!document) {
    document = parseDocument(state.doc.toString())
    parsed.set(state.doc, document)
  }
  return document
}

function element<TTag extends keyof HTMLElementTagNameMap>(
  tag: TTag,
  className: string | null,
  text?: string,
) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * Hovering a command explains it in plain words: what it does and what
 * each of its values means, with the hovered value picked out.
 */
const commandTooltip = hoverTooltip((view, pos) => {
  const command = findCommandAtOffset(documentOf(view.state), pos)
  if (!command) return null
  // Spans run on through the line break after the command.
  const source = view.state.sliceDoc(command.span.start, command.span.end)
  const end = command.span.start + source.trimEnd().length
  if (pos > end) return null

  const explanation = explainCommand(command, {
    dpi: view.state.facet(labelDpi),
  })
  const hovered = parameterIndexAt(command, pos)

  return {
    pos: command.span.start,
    end,
    above: true,
    create() {
      const dom = element('div', 'cm-zpl-command-tooltip')

      const head = element('div', 'cm-zpl-tooltip-head')
      head.append(
        element('strong', null, `${explanation.canonical} ${explanation.name}`),
        element(
          'span',
          'cm-zpl-tooltip-status',
          STATUS_LABEL[explanation.capability?.status ?? 'unknown'](),
        ),
      )
      dom.append(head, element('p', null, explanation.summary))

      if (explanation.parameters.length > 0) {
        const list = element('dl', 'cm-zpl-tooltip-parameters')
        for (const parameter of explanation.parameters) {
          const row = element(
            'div',
            parameter.rawIndex === hovered ? 'cm-zpl-tooltip-active' : null,
          )
          const value = element('dd', null)
          value.append(
            element('code', null, parameter.value ?? '–'),
            ` ${parameter.meaning}`,
          )
          row.append(element('dt', null, parameter.name), value)
          list.append(row)
        }
        dom.append(list)
      }
      return { dom }
    },
  }
})

class HintWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }

  eq(other: HintWidget) {
    return other.text === this.text
  }

  toDOM() {
    const dom = element('span', 'cm-zpl-hint', this.text)
    dom.setAttribute('aria-hidden', 'true')
    return dom
  }
}

function buildHints(view: EditorView): DecorationSet {
  const { doc } = view.state
  const hints = explainDocument(documentOf(view.state), {
    dpi: view.state.facet(labelDpi),
  })

  // Several items on one line share a single note at its end.
  const byLine = new Map<number, string[]>()
  for (const hint of hints) {
    const line = doc.lineAt(Math.min(hint.offset, doc.length)).number
    byLine.set(line, [...(byLine.get(line) ?? []), hint.text])
  }

  return Decoration.set(
    [...byLine].map(([number, texts]) =>
      Decoration.widget({
        widget: new HintWidget(texts.join(' · ')),
        side: 1,
      }).range(doc.line(number).to),
    ),
  )
}

/** A plain-language note at the end of each line saying what it does. */
const explainHints = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildHints(view)
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.startState.facet(labelDpi) !== update.state.facet(labelDpi)
      ) {
        this.decorations = buildHints(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** The parts of the language that depend on the panel's settings. */
export function zplHelp({
  dpi,
  explain,
}: {
  dpi: number
  explain: boolean
}): Extension {
  return [labelDpi.of(dpi), explain ? explainHints : []]
}

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
    gap: '6px',
    maxWidth: '340px',
    padding: '8px 10px',
    lineHeight: '1.45',
  },
  '.cm-zpl-command-tooltip p': { margin: '0' },
  '.cm-zpl-tooltip-head': {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '12px',
  },
  '.cm-zpl-tooltip-status': {
    flexShrink: '0',
    color: 'var(--muted-foreground)',
  },
  '.cm-zpl-tooltip-parameters': {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    columnGap: '10px',
    margin: '0',
    paddingTop: '6px',
    borderTop: '1px solid var(--border)',
  },
  '.cm-zpl-tooltip-parameters > div': {
    display: 'grid',
    gridColumn: '1 / -1',
    gridTemplateColumns: 'subgrid',
    padding: '1px 4px',
    margin: '0 -4px',
  },
  '.cm-zpl-tooltip-parameters dt': { color: 'var(--muted-foreground)' },
  '.cm-zpl-tooltip-parameters dd': { margin: '0' },
  '.cm-zpl-tooltip-parameters code': {
    fontFamily: MONO_FONT,
    fontWeight: '600',
  },
  '.cm-zpl-tooltip-active': { backgroundColor: 'var(--selection-soft)' },
  '.cm-zpl-hint': {
    paddingLeft: '3ch',
    color: 'var(--muted-foreground)',
    fontFamily: SANS_FONT,
    fontSize: '12px',
    userSelect: 'none',
    pointerEvents: 'none',
  },
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
