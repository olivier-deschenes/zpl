import { useId } from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { useSelector } from '@tanstack/react-store'

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '#/components/ui/resizable'
import { Button } from '#/components/ui/button'
import { useElementSize } from '#/hooks/use-element-size'
import { DEFAULT_SETTINGS, dpiFor } from '#/lib/zpl/settings'
import { m } from '#/paraglide/messages'
import { DiskStatusButton } from './disk-status'
import { LabelPreview } from './label-preview'
import { SettingsPopover } from './settings-popover'
import { editorStore, selectFile, setActiveFile } from './store'
import { PanelToolbar } from './toolbar'
import { useLabelRender } from './use-label-render'
import { ZplEditor } from './zpl-editor'

/** A lone panel narrower than this puts the preview under the editor. */
const SIDE_BY_SIDE_MIN_WIDTH = 768

/** Short enough for a narrow header; the settings show the exact size. */
const SIZE_FORMAT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
})

interface EditorPanelProps {
  panelId: string
  count: number
  /** The page is phone-sized, so every panel stacks. */
  stacked: boolean
  /** The panel the preview is compared with, if any. */
  compareTarget: string | null
  autoFocus?: boolean
}

export function EditorPanel({
  panelId,
  count,
  stacked,
  compareTarget,
  autoFocus,
}: EditorPanelProps) {
  const headingId = useId()
  const [sectionRef, { width }] = useElementSize<HTMLElement>()
  const { render, isRendering, error, retry } = useLabelRender(panelId)

  // Several panels share the width, so each puts its code under the
  // label. A lone panel goes side by side once it is wide enough; until the
  // first measurement, assume it is so it doesn't flash stacked.
  const sideBySide =
    !stacked && count === 1 && (width === 0 || width >= SIDE_BY_SIDE_MIN_WIDTH)
  const labelFirst = count > 1
  const title = useSelector(
    editorStore,
    (state) => `${selectFile(state, panelId)?.fileName ?? ''}.zpl`,
  )
  const active = useSelector(
    editorStore,
    (state) => state.activeFileId === panelId,
  )

  const editor = (
    <ResizablePanel
      key="editor"
      id="editor"
      defaultSize={labelFirst ? '40%' : '45%'}
      minSize="20%"
    >
      <ZplEditor panelId={panelId} render={render} autoFocus={autoFocus} />
    </ResizablePanel>
  )
  const preview = (
    <ResizablePanel key="preview" id="preview" minSize="20%">
      <LabelPreview
        panelId={panelId}
        render={render}
        isRendering={isRendering}
        error={error}
        onRetry={retry}
        compareTarget={compareTarget}
      />
    </ResizablePanel>
  )
  const handle = <ResizableHandle key="handle" withHandle />

  return (
    <section
      ref={sectionRef}
      // The skip link follows the selected file, including on a phone.
      id={active ? 'editor' : undefined}
      tabIndex={-1}
      aria-labelledby={headingId}
      onPointerDownCapture={() => setActiveFile(panelId)}
      onFocusCapture={() => setActiveFile(panelId)}
      className="flex h-full min-w-0 flex-col"
    >
      <div className="@container flex h-10 shrink-0 items-center gap-0.5 border-b pr-1.5 pl-3">
        <h2
          id={headingId}
          className="min-w-0 max-w-48 truncate text-xs font-medium"
        >
          {title}
        </h2>
        <DiskStatusButton id={panelId} />
        <SizeButton panelId={panelId} />
        <PanelToolbar
          panelId={panelId}
          labelCount={render?.labels.length ?? 0}
        />
      </div>
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup
          orientation={sideBySide ? 'horizontal' : 'vertical'}
        >
          {labelFirst ? [preview, handle, editor] : [editor, handle, preview]}
        </ResizablePanelGroup>
      </div>
    </section>
  )
}

/** Shows the size the panel renders at, and opens the settings to change it. */
function SizeButton({ panelId }: { panelId: string }) {
  const settings = useSelector(
    editorStore,
    (state) => selectFile(state, panelId)?.settings ?? DEFAULT_SETTINGS,
  )

  return (
    <SettingsPopover panelId={panelId}>
      <Button
        variant="ghost"
        size="xs"
        className="min-w-0 shrink text-muted-foreground tabular-nums"
      >
        <span className="truncate">
          {m.status_size({
            width: SIZE_FORMAT.format(settings.widthIn),
            height: SIZE_FORMAT.format(settings.heightIn),
            dpi: dpiFor(settings.dpmm),
          })}
        </span>
        <IconChevronDown data-icon="inline-end" />
      </Button>
    </SettingsPopover>
  )
}
