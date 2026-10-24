import { useId, useRef, useState } from 'react'
import {
  IconAdjustmentsHorizontal,
  IconChevronDown,
  IconCopy,
  IconX,
} from '@tabler/icons-react'
import { useForm } from '@tanstack/react-form'
import { useSelector } from '@tanstack/react-store'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
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
import {
  DEFAULT_SETTINGS,
  DENSITIES,
  MAX_SIZE_IN,
  MIN_SIZE_IN,
} from '#/lib/zpl/render'
import type { PrintDensity } from '#/lib/zpl/render'
import { m } from '#/paraglide/messages'
import { DownloadDialog } from './download-dialog'
import {
  MAX_PANELS,
  duplicatePanel,
  editorStore,
  insertPanel,
  removePanel,
  selectPanel,
  setFileName,
  setSettings,
} from './store'

interface PanelToolbarProps {
  panelId: string
  /** The panel's display name, used in the close notice. */
  title: string
  /** Labels in the panel's current preview. */
  labelCount: number
}

export function PanelToolbar({
  panelId,
  title,
  labelCount,
}: PanelToolbarProps) {
  const panelCount = useSelector(editorStore, (state) => state.panels.length)

  const close = () => {
    const removed = removePanel(panelId)
    if (!removed) return
    toast(m.panel_closed({ name: title }), {
      duration: 8000,
      action: {
        label: m.undo(),
        onClick: () => insertPanel(removed.panel, removed.index),
      },
    })
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <SettingsPopover panelId={panelId} />
      <ExportMenu panelId={panelId} labelCount={labelCount} />
      <IconButton
        label={m.duplicate_panel()}
        onClick={() => duplicatePanel(panelId)}
        disabled={panelCount >= MAX_PANELS}
      >
        <IconCopy />
      </IconButton>
      {panelCount > 1 && (
        <IconButton label={m.close_panel()} onClick={close}>
          <IconX />
        </IconButton>
      )}
    </div>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function SettingsPopover({ panelId }: { panelId: string }) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={m.settings()}>
              <IconAdjustmentsHorizontal />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{m.settings()}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>{m.settings()}</PopoverTitle>
          <PopoverDescription>{m.settings_hint()}</PopoverDescription>
        </PopoverHeader>
        <SettingsForm panelId={panelId} />
      </PopoverContent>
    </Popover>
  )
}

const sizeSchema = z
  .string()
  .trim()
  .transform(Number)
  .pipe(
    z
      .number({ error: m.invalid_size() })
      .min(MIN_SIZE_IN, m.invalid_size())
      .max(MAX_SIZE_IN, m.invalid_size()),
  )

const settingsSchema = z.object({
  dpmm: z
    .enum(DENSITIES.map(({ dpmm }) => String(dpmm)))
    .transform((value) => Number(value) as PrintDensity),
  widthIn: sizeSchema,
  heightIn: sizeSchema,
})

/** Applies every valid change straight away; invalid input stays visible until fixed. */
function SettingsForm({ panelId }: { panelId: string }) {
  const id = useId()
  const settings =
    selectPanel(editorStore.state, panelId)?.settings ?? DEFAULT_SETTINGS

  const form = useForm({
    defaultValues: {
      dpmm: String(settings.dpmm),
      widthIn: String(settings.widthIn),
      heightIn: String(settings.heightIn),
    },
    listeners: {
      onChange: ({ formApi }) => {
        const parsed = settingsSchema.safeParse(formApi.state.values)
        if (parsed.success) setSettings(panelId, parsed.data)
      },
    },
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => event.preventDefault()}
    >
      <form.Field name="dpmm">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-dpmm`}>{m.density()}</Label>
            <Select
              value={field.state.value}
              onValueChange={field.handleChange}
            >
              <SelectTrigger id={`${id}-dpmm`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DENSITIES.map(({ dpmm, dpi }) => (
                  <SelectItem key={dpmm} value={String(dpmm)}>
                    {dpi} dpi ({dpmm} dpmm)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <div className="grid grid-cols-2 gap-3">
        {(['widthIn', 'heightIn'] as const).map((name) => (
          <form.Field
            key={name}
            name={name}
            validators={{ onChange: sizeSchema }}
          >
            {(field) => {
              const error = field.state.meta.errors.at(0)?.message
              const inputId = `${id}-${name}`
              return (
                <div className="flex min-w-0 flex-col gap-2">
                  <Label htmlFor={inputId}>
                    {name === 'widthIn' ? m.width_in() : m.height_in()}
                  </Label>
                  <Input
                    id={inputId}
                    type="number"
                    inputMode="decimal"
                    step="0.25"
                    min={MIN_SIZE_IN}
                    max={MAX_SIZE_IN}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${inputId}-error` : undefined}
                    className="tabular-nums"
                  />
                  {error && (
                    <p
                      id={`${inputId}-error`}
                      className="text-xs text-destructive"
                    >
                      {error}
                    </p>
                  )}
                </div>
              )
            }}
          </form.Field>
        ))}
      </div>
    </form>
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
    try {
      const name = await exportAs(
        format,
        panel.source,
        panel.settings,
        baseName,
      )
      toast.success(m.downloaded({ name }))
    } catch (error) {
      toast.error(
        m.export_failed({
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }

  const copy = async (copier: typeof copyZpl, done: string) => {
    try {
      await copier(livePanel()?.source ?? '')
      toast.success(done)
    } catch {
      toast.error(m.copy_failed())
    }
  }

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
          <DropdownMenuItem onSelect={() => void copy(copyZpl, m.copied_zpl())}>
            {m.copy_zpl()}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void copy(copyBase64, m.copied_base64())}
          >
            {m.copy_base64()}
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
