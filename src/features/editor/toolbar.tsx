import { useRef, useState } from 'react'
import {
  IconChevronDown,
  IconCopy,
  IconDots,
  IconPlus,
  IconX,
} from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { useSelector } from '@tanstack/react-store'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import {
  DEFAULT_FILE_NAME,
  copyBase64,
  copyZpl,
  exportAs,
} from '#/lib/zpl/export'
import type { ExportFormat } from '#/lib/zpl/export'
import { m } from '#/paraglide/messages'
import { DownloadDialog } from './download-dialog'
import { useCopyShareLink } from './share-link'
import {
  MAX_PANELS,
  addPanel,
  duplicatePanel,
  editorStore,
  removePanel,
  selectPanel,
  setFileName,
} from './store'
import { labelRenderQuery } from './use-label-render'

interface PanelToolbarProps {
  panelId: string
  /** Labels in the panel's current preview. */
  labelCount: number
}

export function PanelToolbar({ panelId, labelCount }: PanelToolbarProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <ExportMenu panelId={panelId} labelCount={labelCount} />
      <PanelMenu panelId={panelId} />
    </div>
  )
}

function PanelMenu({ panelId }: { panelId: string }) {
  const panelCount = useSelector(editorStore, (state) => state.panels.length)
  const full = panelCount >= MAX_PANELS

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={m.panel_actions()}
            >
              <IconDots />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{m.panel_actions()}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem disabled={full} onSelect={() => addPanel(panelId)}>
          <IconPlus />
          {m.add_panel()}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={full}
          onSelect={() => duplicatePanel(panelId)}
        >
          <IconCopy />
          {m.duplicate_panel()}
        </DropdownMenuItem>
        {panelCount > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => removePanel(panelId)}
            >
              <IconX />
              {m.close_panel()}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const DOWNLOADS: ReadonlyArray<{ format: ExportFormat; label: () => string }> =
  [
    { format: 'pdf', label: m.export_pdf },
    { format: 'png', label: m.export_png },
    { format: 'zpl', label: m.export_zpl },
  ]

function ExportMenu({
  panelId,
  labelCount,
}: {
  panelId: string
  labelCount: number
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [dialog, setDialog] = useState({
    /** Bumped per prompt so each one starts fresh, even mid close animation. */
    id: 0,
    open: false,
    format: 'pdf' as ExportFormat,
    defaultName: DEFAULT_FILE_NAME,
  })
  // Exports read the live source, not the debounced one the preview shows.
  const livePanel = () => selectPanel(editorStore.state, panelId)
  const copyShareLink = useCopyShareLink(panelId)
  const queryClient = useQueryClient()

  const promptFileName = (format: ExportFormat) => {
    const { panels } = editorStore.state
    const index = panels.findIndex((panel) => panel.id === panelId)
    // Number the default once there are several panels, so their
    // downloads don't collide.
    const fallback =
      panels.length > 1
        ? `${DEFAULT_FILE_NAME}-${index + 1}`
        : DEFAULT_FILE_NAME
    setDialog((current) => ({
      id: current.id + 1,
      open: true,
      format,
      defaultName: livePanel()?.fileName ?? fallback,
    }))
  }

  const download = async (format: ExportFormat, baseName: string) => {
    const panel = livePanel()
    if (!panel) return
    setFileName(panelId, baseName)
    // Unchanged since the preview caught up, this is the render it shows.
    const labels =
      format === 'zpl'
        ? []
        : (
            await queryClient.fetchQuery(
              labelRenderQuery(panel.source, panel.settings),
            )
          ).labels
    await exportAs(format, panel.source, labels, baseName)
  }

  const copy = (copier: typeof copyZpl) => copier(livePanel()?.source ?? '')

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={triggerRef} variant="outline" size="sm">
            {m.export()}
            <IconChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-44"
          // The file name dialog takes focus; handing it back to the
          // trigger here would steal it.
          onCloseAutoFocus={(event) => {
            if (dialog.open) event.preventDefault()
          }}
        >
          {DOWNLOADS.map(({ format, label }) => (
            <DropdownMenuItem
              key={format}
              onSelect={() => promptFileName(format)}
            >
              {label()}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void copy(copyZpl)}>
            {m.copy_zpl()}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copy(copyBase64)}>
            {m.copy_base64()}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyShareLink()}>
            {m.copy_share_link()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DownloadDialog
        key={dialog.id}
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
        format={dialog.format}
        defaultName={dialog.defaultName}
        labelCount={labelCount}
        onDownload={(baseName) => void download(dialog.format, baseName)}
        returnFocusRef={triggerRef}
      />
    </>
  )
}
