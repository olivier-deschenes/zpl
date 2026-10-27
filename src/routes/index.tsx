import { Fragment, useEffect, useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSelector } from '@tanstack/react-store'
import { IconFolder, IconPlus } from '@tabler/icons-react'

import { Button } from '#/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '#/components/ui/empty'
import { Tabs, TabsContent } from '#/components/ui/tabs'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '#/components/ui/resizable'
import { AppBar } from '#/features/editor/app-bar'
import type { ComparePair } from '#/features/editor/app-bar'
import { EditorPanel } from '#/features/editor/editor-panel'
import { openShareLink } from '#/features/editor/share-link'
import { addFile, editorStore, setActiveFile } from '#/features/editor/store'
import { useMediaQuery } from '#/hooks/use-media-query'
import { m } from '#/paraglide/messages'

/** Keeps the editor and the panel's toolbar usable when panels are squeezed. */
const MIN_PANEL_WIDTH = 280

export const Route = createFileRoute('/')({
  // CodeMirror and the canvas renderer only run in the browser.
  ssr: false,
  beforeLoad: ({ location, preload }) => {
    if (
      !preload &&
      (openShareLink(location.hash) || openShareLink(location.searchStr))
    ) {
      // Clear the label from the address bar so a reload doesn't reopen it.
      throw redirect({ to: '/', search: {}, hash: '', replace: true })
    }
  },
  component: EditorPage,
})

function EditorPage() {
  const stacked = useMediaQuery('(max-width: 767px)')
  const panelIds = useSelector(editorStore, (state) => state.openFileIds)
  const activeId = useSelector(editorStore, (state) => state.activeFileId)
  const hasFiles = useSelector(editorStore, (state) => state.files.length > 0)
  const [libraryOpen, setLibraryOpen] = useState(false)
  // Panels opened after load take focus, ready for a paste.
  const [initialIds] = useState(() => new Set(panelIds))
  const [comparePair, setComparePair] = useState<ComparePair | null>(null)
  // Closing either panel ends the comparison.
  const compare =
    comparePair && comparePair.every((id) => panelIds.includes(id))
      ? comparePair
      : null

  useEffect(() => {
    if (comparePair && !comparePair.every((id) => panelIds.includes(id)))
      setComparePair(null)
  }, [comparePair, panelIds])

  const panel = (id: string) => (
    <TabsContent
      value={id}
      forceMount
      hidden={stacked && activeId !== id}
      className="m-0 h-full min-h-0"
    >
      <EditorPanel
        panelId={id}
        count={panelIds.length}
        stacked={stacked}
        // The first panel of the pair shows the comparison; the other keeps
        // showing its own label.
        compareTarget={compare?.[0] === id ? compare[1] : null}
        autoFocus={!initialIds.has(id)}
      />
    </TabsContent>
  )

  return (
    <Tabs
      value={activeId ?? ''}
      onValueChange={setActiveFile}
      className="h-dvh gap-0"
      asChild
    >
      <main className="flex min-w-0 flex-col">
        <AppBar
          compare={compare}
          onCompareChange={setComparePair}
          libraryOpen={libraryOpen}
          onLibraryOpenChange={setLibraryOpen}
        />
        {panelIds.length === 0 ? (
          <Empty id="editor">
            <EmptyHeader>
              <EmptyTitle>{m.no_open_files()}</EmptyTitle>
              <EmptyDescription>
                {hasFiles ? m.no_open_files_hint() : m.empty_library_hint()}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <div className="flex flex-wrap justify-center gap-2">
                {hasFiles && (
                  <Button
                    variant="outline"
                    onClick={() => setLibraryOpen(true)}
                  >
                    <IconFolder />
                    {m.open_saved_file()}
                  </Button>
                )}
                <Button onClick={() => addFile()}>
                  <IconPlus />
                  {m.new_file()}
                </Button>
              </div>
            </EmptyContent>
          </Empty>
        ) : stacked ? (
          <div className="min-h-0 flex-1">
            {panelIds.map((id) => (
              <Fragment key={id}>{panel(id)}</Fragment>
            ))}
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            <ResizablePanelGroup orientation="horizontal">
              {panelIds.map((id, index) => (
                <Fragment key={id}>
                  {index > 0 && <ResizableHandle className="w-1 bg-border" />}
                  <ResizablePanel id={id} minSize={MIN_PANEL_WIDTH}>
                    {panel(id)}
                  </ResizablePanel>
                </Fragment>
              ))}
            </ResizablePanelGroup>
          </div>
        )}
      </main>
    </Tabs>
  )
}
