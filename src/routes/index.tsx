import { Fragment, useId, useState } from 'react'
import { IconPlus } from '@tabler/icons-react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { shallow, useSelector } from '@tanstack/react-store'

import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '#/components/ui/resizable'
import { Switch } from '#/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { EditorPanel } from '#/features/editor/editor-panel'
import { openShareLink } from '#/features/editor/share-link'
import {
  MAX_PANELS,
  addPanel,
  editorStore,
  setPreviewSource,
} from '#/features/editor/store'
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
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-4">
        <h1 className="text-sm font-semibold">{m.app_title()}</h1>
        <div className="flex items-center gap-4">
          <PreviewSourceSwitch />
          <Button
            variant="outline"
            onClick={() => addPanel()}
            disabled={panelIds.length >= MAX_PANELS}
          >
            <IconPlus data-icon="inline-start" />
            {m.add_panel()}
          </Button>
        </div>
      </header>
      <main className="min-h-0 flex-1">
        {stacked ? (
          // Phones get one full-width panel at a time; swipe between them.
          <div className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain">
            {panelIds.map((id, index) => (
              <div
                key={id}
                className="h-full w-full shrink-0 snap-start not-first:border-l"
              >
                {panel(id, index)}
              </div>
            ))}
          </div>
        ) : (
          <ResizablePanelGroup orientation="horizontal">
            {panelIds.map((id, index) => (
              <Fragment key={id}>
                {index > 0 && <ResizableHandle className="w-1 bg-border" />}
                <ResizablePanel id={id} minSize={MIN_PANEL_WIDTH}>
                  {panel(id, index)}
                </ResizablePanel>
              </Fragment>
            ))}
          </ResizablePanelGroup>
        )}
      </main>
    </div>
  )
}

function PreviewSourceSwitch() {
  const id = useId()
  const hintId = useId()
  const previewSource = useSelector(editorStore, (state) => state.previewSource)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2">
          <Switch
            id={id}
            size="sm"
            checked={previewSource === 'labelary'}
            onCheckedChange={(checked) =>
              setPreviewSource(checked ? 'labelary' : 'local')
            }
            aria-describedby={hintId}
          />
          <Label htmlFor={id} className="whitespace-nowrap">
            {m.preview_labelary()}
          </Label>
        </div>
      </TooltipTrigger>
      <TooltipContent id={hintId}>{m.preview_labelary_hint()}</TooltipContent>
    </Tooltip>
  )
}
