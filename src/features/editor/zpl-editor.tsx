import { useEffect, useMemo, useState } from 'react'
import { lintGutter, setDiagnostics } from '@codemirror/lint'
import type { Diagnostic } from '@codemirror/lint'
import { Compartment } from '@codemirror/state'
import type { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useSelector } from '@tanstack/react-store'
import CodeMirror from '@uiw/react-codemirror'

import { decodeBase64Zpl } from '#/lib/zpl/base64'
import type { LabelaryWarning } from '#/lib/zpl/labelary'
import { DEFAULT_SETTINGS, dpiFor } from '#/lib/zpl/settings'
import { m } from '#/paraglide/messages'
import { editorStore, selectPanel, setSource } from './store'
import type { LabelRender } from './use-label-render'
import { zpl, zplHelp } from './zpl-language'

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
    return true
  },
  drop(event, view) {
    const file = event.dataTransfer?.files[0]
    if (file) {
      // A dropped file replaces the whole label rather than splicing into it.
      event.preventDefault()
      void file.text().then((text) =>
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: decodeBase64Zpl(text) ?? text,
          },
          userEvent: 'input.drop',
        }),
      )
      return true
    }

    const text = event.dataTransfer?.getData('text/plain')
    const decoded = text ? decodeBase64Zpl(text) : null
    if (!decoded) return false

    event.preventDefault()
    const pos =
      view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
      view.state.selection.main.head
    view.dispatch({
      changes: { from: pos, insert: decoded },
      selection: { anchor: pos + decoded.length },
      userEvent: 'input.drop',
    })
    return true
  },
})

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
  const dpi = useSelector(editorStore, (state) =>
    dpiFor(selectPanel(state, panelId)?.settings.dpmm ?? DEFAULT_SETTINGS.dpmm),
  )
  const explain = useSelector(editorStore, (state) => state.explain)
  const [view, setView] = useState<EditorView | null>(null)
  // Holds the explanations, which follow the panel's density and the toggle.
  const [help] = useState(() => new Compartment())

  const extensions = useMemo(
    () => [
      zpl(),
      // Filled in by the effect below once the editor exists.
      help.of([]),
      lintGutter(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': m.editor_label() }),
      base64Input,
    ],
    [help],
  )

  // Runs again when the extensions are swapped, which empties the compartment.
  useEffect(() => {
    view?.dispatch({ effects: help.reconfigure(zplHelp({ dpi, explain })) })
  }, [view, help, extensions, dpi, explain])

  // Offsets only line up with the text they were rendered from, so skip
  // stale results; the next render brings fresh warnings.
  useEffect(() => {
    if (!view || !render) return
    if (render.source !== view.state.doc.toString()) return
    view.dispatch(
      setDiagnostics(
        view.state,
        toLintDiagnostics(render.warnings, view.state.doc),
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

/** Labelary's linter warnings, underlined in the code. */
function toLintDiagnostics(
  warnings: readonly LabelaryWarning[],
  doc: Text,
): Diagnostic[] {
  return warnings.map((warning) => {
    const from = Math.min(warning.from, doc.length)
    const end = Math.min(Math.max(warning.to, from), doc.length)
    // Stopping before a line break keeps the underline off the explanation
    // at the end of the line.
    const to = from + doc.sliceString(from, end).trimEnd().length
    return {
      from,
      to,
      severity: 'warning',
      message: warning.message,
      source: warning.command,
    }
  })
}
