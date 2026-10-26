import { useId } from 'react'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '#/components/ui/resizable'
import { useElementSize } from '#/hooks/use-element-size'
import { m } from '#/paraglide/messages'
import { LabelPreview } from './label-preview'
import { PanelToolbar } from './toolbar'
import { useLabelRender } from './use-label-render'
import { ZplEditor } from './zpl-editor'

/** Narrower panels put the preview under the editor instead of beside it. */
const SIDE_BY_SIDE_MIN_WIDTH = 768

interface EditorPanelProps {
  panelId: string
  index: number
  count: number
  /** The page is phone-sized, so every panel stacks. */
  stacked: boolean
  autoFocus?: boolean
}

export function EditorPanel({
  panelId,
  index,
  count,
  stacked,
  autoFocus,
}: EditorPanelProps) {
  const headingId = useId()
  const [sectionRef, { width }] = useElementSize<HTMLElement>()
  const { render, isRendering, error, retry } = useLabelRender(panelId)

  // Until the first measurement, guess from the page so a lone panel on a
  // wide screen doesn't flash stacked.
  const sideBySide =
    !stacked && (width === 0 ? count === 1 : width >= SIDE_BY_SIDE_MIN_WIDTH)
  const title =
    count === 1 ? m.editor_label() : m.panel_title({ index: index + 1 })

  return (
    <section
      ref={sectionRef}
      // The skip link lands on the first panel.
      id={index === 0 ? 'editor' : undefined}
      aria-labelledby={headingId}
      className="h-full min-w-0"
    >
      <ResizablePanelGroup orientation={sideBySide ? 'horizontal' : 'vertical'}>
        <ResizablePanel defaultSize="45%" minSize="20%">
          <div className="flex h-full min-w-0 flex-col">
            <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b pr-1.5 pl-3">
              <div className="flex min-w-0 items-center gap-2">
                {index === 0 && (
                  <img
                    src="/logo.svg"
                    alt=""
                    width={20}
                    height={20}
                    className="size-5 shrink-0 dark:invert"
                  />
                )}
                <h2 id={headingId} className="truncate text-xs font-medium">
                  {title}
                </h2>
              </div>
              <PanelToolbar
                panelId={panelId}
                labelCount={render?.labels.length ?? 0}
              />
            </div>
            <div className="min-h-0 flex-1">
              <ZplEditor
                panelId={panelId}
                render={render}
                autoFocus={autoFocus}
              />
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel minSize="20%">
          <LabelPreview
            panelId={panelId}
            render={render}
            isRendering={isRendering}
            error={error}
            onRetry={retry}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </section>
  )
}
