import { useEffect, useRef, useState } from 'react'
import {
  IconBinary,
  IconCheck,
  IconCopy,
  IconCopyPlus,
  IconLink,
} from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { useSelector } from '@tanstack/react-store'
import { cn } from 'cn'

import { Button } from '#/components/ui/button'
import { ButtonGroup } from '#/components/ui/button-group'
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
import { MAX_PANELS, duplicateFile, editorStore, selectFile } from './store'
import { labelRenderQuery } from './use-label-render'

/** How long a copy button shows its check mark. */
const COPIED_MS = 1500

interface PanelToolbarProps {
  panelId: string
  /** Labels in the panel's current preview. */
  labelCount: number
}

/**
 * The panel's own actions, in one row of compact buttons. A narrow panel
 * leaves out the least used ones so the row never wraps.
 */
export function PanelToolbar({ panelId, labelCount }: PanelToolbarProps) {
  const panelCount = useSelector(
    editorStore,
    (state) => state.openFileIds.length,
  )
  const livePanel = () => selectFile(editorStore.state, panelId)
  const copyShareLink = useCopyShareLink(panelId)

  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5">
      <CopyButton
        label={m.copy_zpl()}
        icon={<IconCopy />}
        onCopy={() => copyZpl(livePanel()?.source ?? '')}
      />
      <CopyButton
        label={m.copy_base64()}
        icon={<IconBinary />}
        onCopy={() => copyBase64(livePanel()?.source ?? '')}
        className="@max-md:hidden"
      />
      <CopyButton
        label={m.copy_share_link()}
        icon={<IconLink />}
        onCopy={copyShareLink}
        className="@max-2xs:hidden"
      />
      <DownloadButtons panelId={panelId} labelCount={labelCount} />
      <IconButton
        label={m.duplicate_panel()}
        disabled={panelCount >= MAX_PANELS}
        onClick={() => duplicateFile(panelId)}
        className="@max-md:hidden"
      >
        <IconCopyPlus />
      </IconButton>
    </div>
  )
}

function IconButton({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          className={cn('text-muted-foreground', className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Shows a check mark for a moment once the copy goes through. */
function CopyButton({
  label,
  icon,
  onCopy,
  className,
}: {
  label: string
  icon: React.ReactNode
  onCopy: () => Promise<void>
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeout = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timeout)
  }, [copied])

  return (
    <IconButton
      label={copied ? m.copied() : label}
      className={className}
      onClick={() => void onCopy().then(() => setCopied(true))}
    >
      {copied ? <IconCheck /> : icon}
    </IconButton>
  )
}

const DOWNLOADS: ReadonlyArray<{ format: ExportFormat; label: () => string }> =
  [
    { format: 'pdf', label: m.export_pdf },
    { format: 'png', label: m.export_png },
    { format: 'zpl', label: m.export_zpl },
  ]

function DownloadButtons({
  panelId,
  labelCount,
}: {
  panelId: string
  labelCount: number
}) {
  // The button that opened the dialog gets focus back once it closes.
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [dialog, setDialog] = useState({
    /** Bumped per prompt so each one starts fresh, even mid close animation. */
    id: 0,
    open: false,
    format: 'pdf' as ExportFormat,
    defaultName: DEFAULT_FILE_NAME,
  })
  // Exports read the live source, not the debounced one the preview shows.
  const livePanel = () => selectFile(editorStore.state, panelId)
  const queryClient = useQueryClient()

  const promptFileName = (format: ExportFormat) => {
    setDialog((current) => ({
      id: current.id + 1,
      open: true,
      format,
      defaultName: livePanel()?.fileName ?? DEFAULT_FILE_NAME,
    }))
  }

  const download = async (format: ExportFormat, baseName: string) => {
    const panel = livePanel()
    if (!panel) return
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

  return (
    <>
      <ButtonGroup aria-label={m.download()}>
        {DOWNLOADS.map(({ format, label }) => (
          <Button
            key={format}
            variant="outline"
            size="xs"
            aria-label={label()}
            className="px-1.5"
            onClick={(event) => {
              triggerRef.current = event.currentTarget
              promptFileName(format)
            }}
          >
            {format.toUpperCase()}
          </Button>
        ))}
      </ButtonGroup>
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
