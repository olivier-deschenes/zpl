import { Fragment, useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { shallow, useSelector } from '@tanstack/react-store'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '#/components/ui/resizable'
import { AddPanelRail } from '#/features/editor/add-panel-rail'
import { EditorPanel } from '#/features/editor/editor-panel'
import { openShareLink } from '#/features/editor/share-link'
import { editorStore } from '#/features/editor/store'
import { useMediaQuery } from '#/hooks/use-media-query'
import { m } from '#/paraglide/messages'

/** Keeps the editor and the panel's toolbar usable when panels are squeezed. */
const MIN_PANEL_WIDTH = 280

export const Route = createFileRoute('/')({
  // CodeMirror and the canvas renderer only run in the browser.
  ssr: false,
  beforeLoad: ({ location, preload }) => {
    if (!preload && openShareLink(location.hash)) {
      // Clear the label from the address bar so a reload doesn't reopen it.
      throw redirect({ to: '/', hash: '', replace: true })
    }
  },
  component: EditorPage,
})

function EditorPage() {
  const stacked = useMediaQuery('(max-width: 767px)')
  const panelIds = useSelector(
    editorStore,
    (state) => state.panels.map((panel) => panel.id),
    { compare: shallow },
  )
  // Panels opened after load take focus, ready for a paste.
  const [initialIds] = useState(() => new Set(panelIds))

  const panel = (id: string, index: number) => (
    <EditorPanel
      panelId={id}
      index={index}
      count={panelIds.length}
      stacked={stacked}
      autoFocus={!initialIds.has(id)}
    />
  )

  return (
    <main className="flex h-dvh">
      <h1 className="sr-only">{m.app_title()}</h1>
      {stacked ? (
        // Phones get one full-width panel at a time; swipe between them.
        <div className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-none">
          {panelIds.map((id, index) => (
            <div
              key={id}
              className="h-full w-full shrink-0 snap-start not-first:border-l"
            >
              {panel(id, index)}
            </div>
          ))}
          <AddPanelRail />
        </div>
      ) : (
        <>
          <ResizablePanelGroup
            orientation="horizontal"
            className="min-w-0 flex-1"
          >
            {panelIds.map((id, index) => (
              <Fragment key={id}>
                {index > 0 && <ResizableHandle className="w-1 bg-border" />}
                <ResizablePanel id={id} minSize={MIN_PANEL_WIDTH}>
                  {panel(id, index)}
                </ResizablePanel>
              </Fragment>
            ))}
          </ResizablePanelGroup>
          <AddPanelRail />
        </>
      )}
    </main>
  )
}
