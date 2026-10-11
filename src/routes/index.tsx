import { createFileRoute } from '@tanstack/react-router'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '#/components/ui/resizable'
import { LabelPreview } from '#/features/editor/label-preview'
import { Toolbar } from '#/features/editor/toolbar'
import { useLabelRender } from '#/features/editor/use-label-render'
import { ZplEditor } from '#/features/editor/zpl-editor'
import { useMediaQuery } from '#/hooks/use-media-query'
import { m } from '#/paraglide/messages'

export const Route = createFileRoute('/')({
  // CodeMirror and the canvas renderer only run in the browser.
  ssr: false,
  component: EditorPage,
})

function EditorPage() {
  const stacked = useMediaQuery('(max-width: 767px)')
  const { render, isRendering, error } = useLabelRender()

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b px-4">
        <h1 className="text-sm font-semibold">{m.app_title()}</h1>
        <Toolbar />
      </header>
      <main className="min-h-0 flex-1">
        <ResizablePanelGroup orientation={stacked ? 'vertical' : 'horizontal'}>
          <ResizablePanel defaultSize="45%" minSize="20%">
            <section
              id="editor"
              aria-labelledby="editor-heading"
              className="flex h-full min-w-0 flex-col"
            >
              <div className="flex h-10 shrink-0 items-center border-b px-3">
                <h2 id="editor-heading" className="text-xs font-medium">
                  {m.editor_label()}
                </h2>
              </div>
              <div className="min-h-0 flex-1">
                <ZplEditor render={render} />
              </div>
            </section>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel minSize="20%">
            <LabelPreview
              render={render}
              isRendering={isRendering}
              error={error}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
    </div>
  )
}
