import { useEffect, useRef, useState } from 'react'
import {
  IconBinary,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconCopyPlus,
  IconGitCompare,
  IconLink,
  IconX,
} from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { shallow, useSelector } from '@tanstack/react-store'

import { Button } from '#/components/ui/button'
import { ButtonGroup } from '#/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Separator } from '#/components/ui/separator'
import { Toggle } from '#/components/ui/toggle'
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
  duplicatePanel,
  editorStore,
  removePanel,
  selectPanel,
  setExplain,
  setFileName,
} from './store'
import { labelRenderQuery } from './use-label-render'

/** How long a copy button shows its check mark. */
const COPIED_MS = 1500

/** The compare menu's value for comparing with nothing; never a panel id. */
const NO_TARGET = 'nothing'

interface PanelToolbarProps {
  panelId: string
  /** Labels in the panel's current preview. */
  labelCount: number
  /** The panel the preview is compared with, if any. */
  compareTarget: string | null
  onCompareTargetChange: (target: string | null) => void
}

/** Every panel action, laid out in the header so none hides in a menu. */
export function PanelToolbar({
  panelId,
  labelCount,
  compareTarget,
  onCompareTargetChange,
}: PanelToolbarProps) {
  const panelIds = useSelector(
    editorStore,
    (state) => state.panels.map((panel) => panel.id),
    { compare: shallow },
  )
  const full = panelIds.length >= MAX_PANELS
  const livePanel = () => selectPanel(editorStore.state, panelId)
  const copyShareLink = useCopyShareLink(panelId)

  return (
    <div className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <div className="flex items-center gap-1">
        <ExplainToggle />
        <CompareControl
          panels={panelIds
            .filter((id) => id !== panelId)
            .map((id) => ({
              id,
              name: m.panel_title({ index: panelIds.indexOf(id) + 1 }),
            }))}
          target={compareTarget}
          onTargetChange={onCompareTargetChange}
        />
      </div>
      <ToolbarSeparator />
      <div className="flex items-center">
        <CopyButton
          label={m.copy_zpl()}
          icon={<IconCopy />}
          onCopy={() => copyZpl(livePanel()?.source ?? '')}
        />
        <CopyButton
          label={m.copy_base64()}
          icon={<IconBinary />}
          onCopy={() => copyBase64(livePanel()?.source ?? '')}
        />
        <CopyButton
          label={m.copy_share_link()}
          icon={<IconLink />}
          onCopy={copyShareLink}
        />
      </div>
      <ToolbarSeparator />
      <DownloadButtons panelId={panelId} labelCount={labelCount} />
      <ToolbarSeparator />
      <div className="flex items-center">
        <IconButton
          label={m.duplicate_panel()}
          disabled={full}
          onClick={() => duplicatePanel(panelId)}
        >
          <IconCopyPlus />
        </IconButton>
        {panelIds.length > 1 && (
          <IconButton
            label={m.close_panel()}
            onClick={() => removePanel(panelId)}
          >
            <IconX />
          </IconButton>
        )}
      </div>
    </div>
  )
}

function ToolbarSeparator() {
  return <Separator orientation="vertical" className="my-1.5" />
}

function IconButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} {...props}>
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
}: {
  label: string
  icon: React.ReactNode
  onCopy: () => Promise<void>
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
      onClick={() => void onCopy().then(() => setCopied(true))}
    >
      {copied ? <IconCheck /> : icon}
    </IconButton>
  )
}

/** Explain applies to every panel, like the saved setting behind it. */
function ExplainToggle() {
  const explain = useSelector(editorStore, (state) => state.explain)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          variant="outline"
          size="sm"
          pressed={explain}
          onPressedChange={setExplain}
        >
          {m.explain()}
        </Toggle>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{m.explain_hint()}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Compares with the only other panel in one press, or picks which one when
 * there are several.
 */
function CompareControl({
  panels,
  target,
  onTargetChange,
}: {
  /** The other panels, in order. */
  panels: ReadonlyArray<{ id: string; name: string }>
  target: string | null
  onTargetChange: (target: string | null) => void
}) {
  if (panels.length === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A disabled button gets no pointer events, so this holds the tooltip. */}
          <span tabIndex={0}>
            <Toggle variant="outline" size="sm" disabled>
              <IconGitCompare />
              {m.compare()}
            </Toggle>
          </span>
        </TooltipTrigger>
        <TooltipContent>{m.compare_add_panel_hint()}</TooltipContent>
      </Tooltip>
    )
  }

  if (panels.length === 1) {
    const [only] = panels
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            variant="outline"
            size="sm"
            pressed={target === only.id}
            onPressedChange={(pressed) =>
              onTargetChange(pressed ? only.id : null)
            }
          >
            <IconGitCompare />
            {m.compare()}
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>
          {m.compare_with_name({ name: only.name })}
        </TooltipContent>
      </Tooltip>
    )
  }

  const targetName = panels.find((panel) => panel.id === target)?.name

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Toggle variant="outline" size="sm" pressed={target !== null}>
          <IconGitCompare />
          {targetName ? m.compare_target({ name: targetName }) : m.compare()}
          <IconChevronDown />
        </Toggle>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{m.compare_with()}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={target ?? NO_TARGET}
          onValueChange={(next) =>
            onTargetChange(next === NO_TARGET ? null : next)
          }
        >
          <DropdownMenuRadioItem value={NO_TARGET}>
            {m.compare_nothing()}
          </DropdownMenuRadioItem>
          {panels.map(({ id, name }) => (
            <DropdownMenuRadioItem key={id} value={id}>
              {name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
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
  const livePanel = () => selectPanel(editorStore.state, panelId)
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

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground @max-2xl:hidden">
        {m.download()}
      </span>
      <ButtonGroup aria-label={m.download()}>
        {DOWNLOADS.map(({ format, label }) => (
          <Tooltip key={format}>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-label={label()}
                onClick={(event) => {
                  triggerRef.current = event.currentTarget
                  promptFileName(format)
                }}
              >
                {format.toUpperCase()}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{label()}</TooltipContent>
          </Tooltip>
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
    </div>
  )
}
