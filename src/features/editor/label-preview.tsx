import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  IconAlertTriangle,
  IconChevronDown,
  IconDots,
  IconGitCompare,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react'
import { shallow, useSelector } from '@tanstack/react-store'
import { cn } from 'cn'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { useElementSize } from '#/hooks/use-element-size'
import { DIFF_COLORS, diffInk, rgb } from '#/lib/zpl/diff'
import { LabelaryError } from '#/lib/zpl/labelary'
import type { LabelaryLabel } from '#/lib/zpl/labelary'
import {
  DEFAULT_SETTINGS,
  MAX_SIZE_IN,
  MIN_SIZE_IN,
  dotsToInches,
  dpiFor,
  labelDots,
} from '#/lib/zpl/settings'
import type { LabelSettings, ZplSize } from '#/lib/zpl/settings'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { SettingsPopover } from './settings-popover'
import { editorStore, selectPanel, setExplain, setSettings } from './store'
import { useOtherPanelRender } from './use-label-render'
import type { LabelRender } from './use-label-render'

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
/** The zoom menu's shortcuts, besides fitting the pane. */
const ZOOM_PRESETS = [0.5, 1, 2]
const VIEWPORT_PADDING = 24
/** Between the two labels when comparing side by side. */
const PAIR_GAP = 16
/** A figure's caption line and the gap above it. */
const CAPTION_HEIGHT = 16 + 8
/** A side-by-side column's title line and the gap below it. */
const COLUMN_TITLE_HEIGHT = 16 + 6

/** The compare menu's value for comparing with nothing; never a panel id. */
const NO_TARGET = 'nothing'

type CompareMode = 'side-by-side' | 'difference'
/** The panel's labels alone, or compared with another panel's. */
type View = 'single' | CompareMode
type Zoom = number | 'fit'

/** Another panel's labels, and what to call both sides. */
interface Compared {
  labels: readonly LabelaryLabel[]
  /** The labels are for older source and are being replaced. */
  stale: boolean
  /** Shown in place of a missing label. */
  placeholder: string
  localTitle: string
  remoteTitle: string
  onlyLocal: string
  onlyRemote: string
}

interface LabelPreviewProps {
  panelId: string
  render: LabelRender | undefined
  isRendering: boolean
  error: Error | null
  onRetry: () => void
}

export function LabelPreview({
  panelId,
  render,
  isRendering,
  error,
  onRetry,
}: LabelPreviewProps) {
  const headingId = useId()
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [viewportRef, viewport] = useElementSize<HTMLDivElement>()
  const panelIds = useSelector(
    editorStore,
    (state) => state.panels.map((panel) => panel.id),
    { compare: shallow },
  )
  const [compareWith, setCompareWith] = useState<string | null>(null)
  const [compareMode, setCompareMode] = useState<CompareMode>('side-by-side')
  // Closing the other panel ends the comparison.
  const target =
    compareWith !== null && panelIds.includes(compareWith) ? compareWith : null
  const view: View = target ? compareMode : 'single'
  const other = useOtherPanelRender(target ?? undefined)

  const panelName = (id: string) =>
    m.panel_title({ index: panelIds.indexOf(id) + 1 })
  const compared: Compared | undefined = target
    ? {
        labels: other.render?.labels ?? [],
        stale: other.isStale,
        placeholder: m.compare_no_panel_label({ name: panelName(target) }),
        localTitle: panelName(panelId),
        remoteTitle: panelName(target),
        onlyLocal: m.diff_only({ name: panelName(panelId) }),
        onlyRemote: m.diff_only({ name: panelName(target) }),
      }
    : undefined

  const labels = render?.labels ?? []
  // Another panel's labels may be bigger, and a difference overlay is as
  // big as the larger label of the pair.
  const sized = [...labels, ...(compared?.labels.slice(0, labels.length) ?? [])]
  const widest = Math.max(1, ...sized.map((label) => label.width))
  const tallest = Math.max(1, ...sized.map((label) => label.height))
  const columns = view === 'side-by-side' ? 2 : 1
  const chromeHeight =
    CAPTION_HEIGHT + (view === 'side-by-side' ? COLUMN_TITLE_HEIGHT : 0)
  // Fit shows each label whole, so the pane only scrolls between labels.
  // Rounded down so a fraction of a pixel never brings in a scrollbar.
  // With nothing to fit, a new empty panel would read "Zoom 60000%".
  const fitScale =
    labels.length === 0
      ? 1
      : Math.max(
          ZOOM_STEPS[0],
          Math.floor(
            Math.min(
              (viewport.width -
                VIEWPORT_PADDING * 2 -
                PAIR_GAP * (columns - 1)) /
                (widest * columns),
              (viewport.height - VIEWPORT_PADDING * 2 - chromeHeight) / tallest,
            ) * 1000,
          ) / 1000,
        )
  const scale = zoom === 'fit' ? fitScale : zoom

  return (
    <section
      aria-labelledby={headingId}
      className="flex h-full min-w-0 flex-col"
    >
      <h3 id={headingId} className="sr-only">
        {m.preview_label()}
      </h3>

      {compared && (
        <CompareBar
          mode={compareMode}
          onModeChange={setCompareMode}
          compared={compared}
        />
      )}

      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-auto overscroll-none bg-muted"
      >
        {labels.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {m.empty_preview()}
          </p>
        ) : (
          <div
            className="flex w-max min-w-full flex-col items-center gap-6"
            style={{ padding: VIEWPORT_PADDING }}
          >
            {labels.map((label, index) => (
              <LabelFigure
                key={index}
                view={view}
                caption={m.label_caption({
                  index: index + 1,
                  count: render?.total ?? labels.length,
                })}
                label={label}
                remote={compared?.labels.at(index)}
                compared={compared}
                scale={scale}
              />
            ))}
          </div>
        )}
      </div>

      <StatusLine
        panelId={panelId}
        render={render}
        isRendering={isRendering}
        error={error}
        onRetry={onRetry}
        otherPanel={
          target && other.render
            ? {
                name: panelName(target),
                labelCount: other.render.labels.length,
              }
            : undefined
        }
      >
        <CompareMenu
          target={target}
          panels={panelIds
            .filter((id) => id !== panelId)
            .map((id) => ({ id, name: panelName(id) }))}
          onTargetChange={setCompareWith}
        />
        <ZoomMenu zoom={zoom} scale={scale} onZoomChange={setZoom} />
        <OptionsMenu />
      </StatusLine>
    </section>
  )
}

/** Picks another panel to compare with. */
function CompareMenu({
  target,
  panels,
  onTargetChange,
}: {
  target: string | null
  /** The other panels, in order. */
  panels: ReadonlyArray<{ id: string; name: string }>
  onTargetChange: (target: string | null) => void
}) {
  const targetName = panels.find((panel) => panel.id === target)?.name

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={cn(
            'text-muted-foreground',
            target && 'bg-muted text-foreground',
          )}
        >
          <IconGitCompare data-icon="inline-start" />
          {targetName ? m.compare_target({ name: targetName }) : m.compare()}
          <IconChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-52">
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
        {panels.length === 0 && (
          <DropdownMenuItem disabled>
            {m.compare_add_panel_hint()}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ZoomMenu({
  zoom,
  scale,
  onZoomChange,
}: {
  zoom: Zoom
  /** The zoom in effect, which fitting the pane works out. */
  scale: number
  onZoomChange: (zoom: Zoom) => void
}) {
  const percent = (value: number) => Math.round(value * 100)
  const larger = ZOOM_STEPS.find((step) => step > scale * 1.01)
  const smaller = ZOOM_STEPS.filter((step) => step < scale * 0.99).at(-1)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-label={m.zoom_level({ percent: percent(scale) })}
          className="text-muted-foreground tabular-nums"
        >
          {m.zoom_percent({ percent: percent(scale) })}
          <IconChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-40">
        {/* Stepping keeps the menu open, so a few clicks zoom a long way. */}
        <DropdownMenuItem
          disabled={larger === undefined}
          onSelect={(event) => {
            event.preventDefault()
            if (larger) onZoomChange(larger)
          }}
        >
          <IconZoomIn />
          {m.zoom_in()}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={smaller === undefined}
          onSelect={(event) => {
            event.preventDefault()
            if (smaller) onZoomChange(smaller)
          }}
        >
          <IconZoomOut />
          {m.zoom_out()}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={String(zoom)}
          onValueChange={(value) =>
            onZoomChange(value === 'fit' ? 'fit' : Number(value))
          }
        >
          <DropdownMenuRadioItem value="fit">
            {m.zoom_fit()}
          </DropdownMenuRadioItem>
          {ZOOM_PRESETS.map((preset) => (
            <DropdownMenuRadioItem key={preset} value={String(preset)}>
              {m.zoom_percent({ percent: percent(preset) })}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
/** Editor options that apply to every panel, like the saved settings behind them. */
function OptionsMenu() {
  const explain = useSelector(editorStore, (state) => state.explain)

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={m.options()}
              className="text-muted-foreground"
            >
              <IconDots />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{m.options()}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="end" className="w-64">
        <DropdownMenuCheckboxItem
          checked={explain}
          onCheckedChange={setExplain}
          className="flex-col items-start gap-0.5"
        >
          {m.explain()}
          <span className="text-xs text-muted-foreground">
            {m.explain_hint()}
          </span>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CompareBar({
  mode,
  onModeChange,
  compared,
}: {
  mode: CompareMode
  onModeChange: (mode: CompareMode) => void
  compared: Compared
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={mode}
        // Radix reports an empty value when the pressed item is pressed again.
        onValueChange={(value) => {
          if (value) onModeChange(value as CompareMode)
        }}
        aria-label={m.compare_view()}
      >
        <ToggleGroupItem value="side-by-side">
          {m.compare_side_by_side()}
        </ToggleGroupItem>
        <ToggleGroupItem value="difference">
          {m.compare_difference()}
        </ToggleGroupItem>
      </ToggleGroup>
      {mode === 'difference' && (
        <DiffLegend
          onlyLocal={compared.onlyLocal}
          onlyRemote={compared.onlyRemote}
        />
      )}
    </div>
  )
}

function DiffLegend({
  onlyLocal,
  onlyRemote,
}: {
  onlyLocal: string
  onlyRemote: string
}) {
  const entries = [
    [DIFF_COLORS.both, m.diff_both()],
    [DIFF_COLORS.onlyA, onlyLocal],
    [DIFF_COLORS.onlyB, onlyRemote],
  ] as const

  return (
    <ul
      aria-label={m.diff_legend()}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
    >
      {entries.map(([color, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 shrink-0 ring-1 ring-border"
            style={{ backgroundColor: rgb(color) }}
          />
          {label}
        </li>
      ))}
    </ul>
  )
}
interface LabelFigureProps {
  view: View
  caption: string
  label: LabelaryLabel
  /** The label at the same position in the compared panel, if it has one. */
  remote: LabelaryLabel | undefined
  compared: Compared | undefined
  scale: number
}

function LabelFigure({
  view,
  caption,
  label,
  remote,
  compared,
  scale,
}: LabelFigureProps) {
  if (view === 'difference' && remote && compared) {
    return (
      <DiffFigure
        caption={caption}
        label={label}
        remote={remote}
        remoteTitle={compared.remoteTitle}
        stale={compared.stale}
        scale={scale}
      />
    )
  }

  const surface = (
    <RasterSurface
      image={label.canvas}
      width={label.width}
      height={label.height}
      scale={scale}
    />
  )

  return (
    <figure className="flex flex-col items-center gap-2">
      {view === 'single' || !compared ? (
        surface
      ) : (
        <div className="flex items-start" style={{ gap: PAIR_GAP }}>
          <RenderColumn title={compared.localTitle}>{surface}</RenderColumn>
          <RenderColumn title={compared.remoteTitle}>
            {remote ? (
              <RasterSurface
                image={remote.canvas}
                width={remote.width}
                height={remote.height}
                scale={scale}
                className={cn(
                  'transition-opacity',
                  compared.stale && 'opacity-50',
                )}
              />
            ) : (
              <div
                className="flex items-center justify-center border border-dashed p-4 text-center text-xs text-muted-foreground"
                style={{
                  width: label.width * scale,
                  height: label.height * scale,
                }}
              >
                {compared.placeholder}
              </div>
            )}
          </RenderColumn>
        </div>
      )}
      <figcaption className="text-xs text-muted-foreground">
        {view === 'difference' && compared
          ? `${caption} · ${compared.placeholder}`
          : caption}
      </figcaption>
    </figure>
  )
}

function DiffFigure({
  caption,
  label,
  remote,
  remoteTitle,
  stale,
  scale,
}: {
  caption: string
  label: LabelaryLabel
  remote: LabelaryLabel
  remoteTitle: string
  stale: boolean
  scale: number
}) {
  const diff = useMemo(
    () => drawInkDiff(label.canvas, remote.canvas),
    [label, remote],
  )
  const summary =
    diff.differing === 0
      ? m.diff_identical({ name: remoteTitle })
      : m.diff_summary({ percent: formatPercent(diff.differing / diff.inked) })
  const sizesDiffer =
    remote.width !== label.width || remote.height !== label.height

  return (
    <figure className="flex flex-col items-center gap-2">
      <RasterSurface
        image={diff.canvas}
        width={diff.canvas.width}
        height={diff.canvas.height}
        scale={scale}
        className={cn('transition-opacity', stale && 'opacity-50')}
      />
      <figcaption className="text-xs text-muted-foreground">
        {caption} · {summary}
        {sizesDiffer && ` · ${m.diff_sizes_differ()}`}
      </figcaption>
    </figure>
  )
}

function RenderColumn({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      {children}
    </div>
  )
}

/** A label image at the preview's zoom. */
function RasterSurface({
  image,
  width,
  height,
  scale,
  className,
}: {
  image: HTMLCanvasElement
  width: number
  height: number
  scale: number
  className?: string
}) {
  const canvasRef = useCanvasCopy(image)
  return (
    <div
      className={cn(
        'relative bg-white shadow-sm ring-1 ring-border',
        className,
      )}
      style={{ width: width * scale, height: height * scale }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        aria-hidden
        className="absolute inset-0 size-full"
        style={{ imageRendering: scale > 1 ? 'pixelated' : 'auto' }}
      />
    </div>
  )
}

/** Keeps a displayed canvas in sync with the one it shows. */
function useCanvasCopy(image: HTMLCanvasElement) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0)
  }, [image])
  return canvasRef
}

function drawInkDiff(local: HTMLCanvasElement, remote: HTMLCanvasElement) {
  const diff = diffInk(readPixels(local), readPixels(remote))
  const canvas = document.createElement('canvas')
  canvas.width = diff.width
  canvas.height = diff.height
  canvas
    .getContext('2d')
    ?.putImageData(new ImageData(diff.data, diff.width, diff.height), 0, 0)
  return { canvas, differing: diff.differing, inked: diff.inked }
}

function readPixels(canvas: HTMLCanvasElement) {
  const { width, height } = canvas
  const context = canvas.getContext('2d')
  if (!context) return { width, height, data: new Uint8ClampedArray(0) }
  return context.getImageData(0, 0, width, height)
}

function formatPercent(ratio: number) {
  return new Intl.NumberFormat(getLocale(), {
    style: 'percent',
    maximumSignificantDigits: 2,
  }).format(ratio)
}
function StatusLine({
  panelId,
  render,
  isRendering,
  error,
  onRetry,
  otherPanel,
  children,
}: LabelPreviewProps & {
  /** The panel being compared with, once its render is available. */
  otherPanel?: { name: string; labelCount: number }
  /** Controls at the end of the line. */
  children?: React.ReactNode
}) {
  const settings = useSelector(
    editorStore,
    (state) => selectPanel(state, panelId)?.settings ?? DEFAULT_SETTINGS,
  )
  const labels = render?.labels ?? []
  const problems = render?.warnings.length ?? 0
  const zplSize = render ? zplSizeSettings(render.zplSize, settings) : null

  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t py-1 pr-1.5 pl-1.5 text-xs text-muted-foreground tabular-nums">
      <SettingsPopover panelId={panelId}>
        <Button variant="ghost" size="xs" className="text-muted-foreground">
          {m.status_size({
            width: settings.widthIn,
            height: settings.heightIn,
            dpi: dpiFor(settings.dpmm),
          })}
          <IconChevronDown data-icon="inline-end" />
        </Button>
      </SettingsPopover>
      {zplSize && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="text-warning hover:text-warning"
              onClick={() => setSettings(panelId, zplSize)}
            >
              <IconAlertTriangle data-icon="inline-start" />
              {m.zpl_size_differs({
                width: zplSize.widthIn,
                height: zplSize.heightIn,
              })}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{m.use_zpl_size()}</TooltipContent>
        </Tooltip>
      )}
      <div
        role="status"
        aria-live="polite"
        className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1"
      >
        {error ? (
          <span className="flex items-center gap-2">
            <span className="text-destructive">
              {error instanceof LabelaryError && error.status === 429
                ? m.render_rate_limited()
                : m.render_failed({ message: error.message })}
            </span>
            <Button variant="outline" size="xs" onClick={onRetry}>
              {m.retry()}
            </Button>
          </span>
        ) : null}
        {render && (
          <>
            <span>
              {render.total > labels.length
                ? m.status_first_labels({
                    shown: labels.length,
                    count: render.total,
                  })
                : labels.length === 1
                  ? m.status_one_label()
                  : m.status_many_labels({ count: labels.length })}
            </span>
            <span className={problems > 0 ? 'text-foreground' : undefined}>
              {problems === 0
                ? m.status_no_problems()
                : problems === 1
                  ? m.status_one_problem()
                  : m.status_many_problems({ count: problems })}
            </span>
          </>
        )}
        {otherPanel && otherPanel.labelCount !== labels.length && (
          <span className="text-foreground">
            {otherPanel.labelCount === 1
              ? m.compare_panel_one_label({ name: otherPanel.name })
              : m.compare_panel_many_labels({
                  name: otherPanel.name,
                  count: otherPanel.labelCount,
                })}
          </span>
        )}
        {isRendering && <span className="ml-auto">{m.status_rendering()}</span>}
      </div>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

/**
 * The settings that would render at the size the ZPL's ^PW / ^LL ask for,
 * or null when they already do. A side the ZPL leaves out keeps its size.
 */
function zplSizeSettings(
  zplSize: ZplSize,
  settings: LabelSettings,
): Pick<LabelSettings, 'widthIn' | 'heightIn'> | null {
  const dots = labelDots(settings)
  const width = zplSize.width ?? dots.width
  const height = zplSize.height ?? dots.height
  if (width === dots.width && height === dots.height) return null
  // Three decimals round back to the same dots even at 600 dpi.
  const inches = (value: number) =>
    Math.min(
      Math.max(
        Number(dotsToInches(value, settings.dpmm).toFixed(3)),
        MIN_SIZE_IN,
      ),
      MAX_SIZE_IN,
    )
  return { widthIn: inches(width), heightIn: inches(height) }
}
