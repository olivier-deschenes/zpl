import { useEffect, useMemo, useState } from 'react'
import { undo } from '@codemirror/commands'
import { lintGutter, setDiagnostics } from '@codemirror/lint'
import type { Diagnostic } from '@codemirror/lint'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useSelector } from '@tanstack/react-store'
import CodeMirror from '@uiw/react-codemirror'
import { toast } from 'sonner'

import { decodeBase64Zpl } from '#/lib/zpl/base64'
import type { ZplDiagnostic } from '#/lib/zpl/render'
import { m } from '#/paraglide/messages'
import { uniqueDiagnostics } from './diagnostics'
import { editorStore, selectPanel, setSelection, setSource } from './store'
import type { LabelRender } from './use-label-render'
import { fromPreview, setHighlight, zpl } from './zpl-language'

/** Offers to keep the raw base64 instead: undo the decode, then insert it as-is. */
function announceDecoded(view: EditorView, keepRaw: () => void) {
  toast(m.decoded_base64(), {
    duration: 8000,
    action: {
      label: m.undo(),
      onClick: () => {
        undo(view)
        keepRaw()
      },
    },
  })
}

/** Pasted or dropped base64 is decoded to ZPL before it reaches the document. */
const base64Input = EditorView.domEventHandlers({
  paste(event, view) {
    const text = event.clipboardData?.getData('text/plain')
    const decoded = text ? decodeBase64Zpl(text) : null
    if (!decoded) return false

    event.preventDefault()
    view.dispatch(view.state.replaceSelection(decoded), {
      userEvent: 'input.paste',
      scrollIntoView: true,
    })
    announceDecoded(view, () =>
      view.dispatch(view.state.replaceSelection(text ?? ''), {
        userEvent: 'input.paste',
      }),
    )
    return true
  },
  drop(event, view) {
    const file = event.dataTransfer?.files[0]
    if (file) {
      // A dropped file replaces the whole label rather than splicing into it.
      event.preventDefault()
      void file.text().then((text) => {
        const replaceAll = (insert: string) =>
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert },
            userEvent: 'input.drop',
          })
        const decoded = decodeBase64Zpl(text)
        replaceAll(decoded ?? text)
        if (decoded) announceDecoded(view, () => replaceAll(text))
      })
      return true
    }

    const text = event.dataTransfer?.getData('text/plain')
    const decoded = text ? decodeBase64Zpl(text) : null
    if (!decoded) return false

    event.preventDefault()
    const pos =
      view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
      view.state.selection.main.head
    const insertAt = (insert: string) =>
      view.dispatch({
        changes: { from: pos, insert },
        selection: { anchor: pos + insert.length },
        userEvent: 'input.drop',
      })
    insertAt(decoded)
    announceDecoded(view, () => insertAt(text ?? ''))
    return true
  },
})

/** Tells the panel's preview where the cursor is so it can outline that field. */
function selectionSync(panelId: string) {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet) return
    if (update.transactions.some((tr) => tr.annotation(fromPreview))) return
    const { head } = update.state.selection.main
    setSelection(panelId, { from: head, to: head, origin: 'editor' })
  })
}

interface ZplEditorProps {
  panelId: string
  render: LabelRender | undefined
  autoFocus?: boolean
}

export function ZplEditor({ panelId, render, autoFocus }: ZplEditorProps) {
  const source = useSelector(
    editorStore,
    (state) => selectPanel(state, panelId)?.source ?? '',
  )
  const selection = useSelector(
    editorStore,
    (state) => state.selections[panelId] ?? null,
  )
  const [view, setView] = useState<EditorView | null>(null)

  const extensions = useMemo(
    () => [
      zpl(),
      lintGutter(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': m.editor_label() }),
      base64Input,
      selectionSync(panelId),
    ],
    [panelId],
  )

  // Follow clicks in the preview: highlight the field's code and scroll to it.
  useEffect(() => {
    if (!view) return
    if (selection === null) {
      view.dispatch({ effects: setHighlight.of(null) })
      return
    }
    if (selection.origin !== 'preview') return

    const length = view.state.doc.length
    const from = Math.min(selection.from, length)
    const to = Math.min(selection.to, length)
    view.dispatch({
      selection: EditorSelection.cursor(from),
      effects: [
        setHighlight.of({ from, to }),
        EditorView.scrollIntoView(from, { y: 'center' }),
      ],
      annotations: fromPreview.of(true),
    })
  }, [view, selection])

  // Spans only line up with the text they were rendered from, so skip stale
  // results; the next render brings fresh diagnostics.
  useEffect(() => {
    if (!view || !render) return
    if (render.source !== view.state.doc.toString()) return
    view.dispatch(
      setDiagnostics(
        view.state,
        toLintDiagnostics(render.result.diagnostics, view.state.doc.length),
      ),
    )
  }, [view, render])

  return (
    <CodeMirror
      value={source}
      onChange={(value) => setSource(panelId, value)}
      onCreateEditor={setView}
      autoFocus={autoFocus}
      extensions={extensions}
      theme="none"
      height="100%"
      className="h-full"
      basicSetup={{ foldGutter: false, autocompletion: false }}
    />
  )
}

function toLintDiagnostics(
  diagnostics: readonly ZplDiagnostic[],
  length: number,
): Diagnostic[] {
  return uniqueDiagnostics(diagnostics).flatMap((diagnostic) => {
    if (!diagnostic.span) return []
    const from = Math.min(diagnostic.span.start, length)
    const to = Math.min(Math.max(diagnostic.span.end, from), length)
    return [
      {
        from,
        to,
        severity: diagnostic.severity,
        message: diagnostic.message,
        source: diagnostic.code,
      },
    ]
  })
}
