import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import {
  IconApi,
  IconBolt,
  IconChevronDown,
  IconGitCompare,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react'
import { shallow, useSelector } from '@tanstack/react-store'
import { cn } from 'cn'
import { findHighlightRegionAtPoint } from 'zplr/web'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
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
import { DEFAULT_SETTINGS, dotsToInches, dpiFor } from '#/lib/zpl/render'
import type { HighlightRegion, RenderedLabel } from '#/lib/zpl/render'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { lineAt, lineStarts, uniqueDiagnostics } from './diagnostics'
import { SettingsPopover } from './settings-popover'
import {
  editorStore,
  selectPanel,
  setPreviewSource,
  setSelection,
} from './store'
import type { PreviewSource, SourceSelection } from './store'
import { useOtherPanelRender } from './use-label-render'
import type { LabelRender } from './use-label-render'
import { useLabelaryRender } from './use-labelary-render'

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
/** The zoom menu's shortcuts, besides fitting the pane. */
const ZOOM_PRESETS = [0.5, 1, 2]
const VIEWPORT_PADDING = 24
/** Between the two renders when comparing side by side. */
const PAIR_GAP = 16
/** A figure's caption line and the gap above it. */
const CAPTION_HEIGHT = 16 + 8
/** A side-by-side column's title line and the gap below it. */
const COLUMN_TITLE_HEIGHT = 16 + 6

type Label = RenderedLabel<HTMLCanvasElement>
type CompareMode = 'side-by-side' | 'difference'
/** A single render from either source, or the two compared. */
type View = PreviewSource | CompareMode
type Comparison = ReturnType<typeof useLabelaryRender>
/** What the preview is compared with: Labelary's render or another panel. */
type CompareTarget = { kind: 'labelary' } | { kind: 'panel'; panelId: string }
type Zoom = number | 'fit'

/** A label from Labelary or another panel, set beside this panel's. */
interface ComparedLabel {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

/** The labels a preview is compared with, and what to call both sides. */
interface Compared {
  labels: readonly ComparedLabel[]
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
}

export function LabelPreview({
  panelId,
  render,
  isRendering,
  error,
}: LabelPreviewProps) {
  const headingId = useId()
  const selection = useSelector(
    editorStore,
    (state) => state.selections[panelId] ?? null,
  )
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [viewportRef, viewport] = useElementSize<HTMLDivElement>()
  const panelIds = useSelector(
    editorStore,
    (state) => state.panels.map((panel) => panel.id),
    { compare: shallow },
  )
  // Off on every load: comparing with Labelary sends the ZPL to labelary.com.
  const [compareWith, setCompareWith] = useState<CompareTarget | null>(null)
  const [compareMode, setCompareMode] = useState<CompareMode>('side-by-side')
  const previewSource = useSelector(editorStore, (state) => state.previewSource)
  // Closing the other panel ends the comparison.
  const target =
    compareWith?.kind === 'panel' && !panelIds.includes(compareWith.panelId)
      ? null
      : compareWith
  const view: View = target ? compareMode : previewSource
  const comparison = useLabelaryRender(
    render,
    target ? target.kind === 'labelary' : previewSource === 'labelary',
  )
  const { labelary } = comparison
  const other = useOtherPanelRender(
    target?.kind === 'panel' ? target.panelId : undefined,
  )

  const panelName = (id: string) =>
    m.panel_title({ index: panelIds.indexOf(id) + 1 })
  const compared: Compared =
    target?.kind === 'panel'
      ? {
          labels: other.render?.result.labels ?? [],
          stale: other.isStale,
          placeholder: m.compare_no_panel_label({
            name: panelName(target.panelId),
          }),
          localTitle: panelName(panelId),
          remoteTitle: panelName(target.panelId),
          onlyLocal: m.diff_only({ name: panelName(panelId) }),
          onlyRemote: m.diff_only({ name: panelName(target.panelId) }),
        }
      : {
          labels: labelary?.labels ?? [],
          stale: comparison.isStale,
          placeholder: labelary
            ? m.compare_no_label()
            : comparison.error
              ? m.compare_unavailable()
              : m.compare_loading(),
          localTitle: m.compare_editor(),
          remoteTitle: m.compare_labelary_title(),
          onlyLocal: m.diff_only_editor(),
          onlyRemote: m.diff_only_labelary(),
        }

  // Views drawing Labelary over the local render's regions keep to the
  // render its labels were fetched for, so the two always line up while a
  // newer one is on its way.
  const shown =
    target?.kind !== 'panel' &&
    (view === 'difference' || view === 'labelary') &&
    labelary
      ? labelary.local
      : render
  const labels = shown?.result.labels ?? []
  // Another panel's labels may be bigger, and a difference overlay is as
  // big as the larger label of the pair.
  const sized = [
    ...labels,
    ...(target ? compared.labels.slice(0, labels.length) : []),
  ]
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
  const starts = useMemo(() => lineStarts(shown?.source ?? ''), [shown])

  return (
    <section
      aria-labelledby={headingId}
      className="flex h-full min-w-0 flex-col"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <h3 id={headingId} className="sr-only">
          {m.preview_label()}
        </h3>
        {/* Applies to every panel, like the saved setting behind it. */}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={previewSource}
          // Radix reports an empty value when the pressed item is pressed again.
          onValueChange={(value) => {
            if (value) setPreviewSource(value as PreviewSource)
          }}
          aria-label={m.preview_source()}
        >
          <ToggleGroupItem value="local">
            <IconBolt />
            {m.preview_live()}
          </ToggleGroupItem>
          {/* The tooltip sits inside so its data-state doesn't replace the item's. */}
          <ToggleGroupItem value="labelary">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1">
                  <IconApi />
                  {m.preview_api()}
                </span>
              </TooltipTrigger>
              <TooltipContent>{m.preview_api_hint()}</TooltipContent>
            </Tooltip>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {target && (
        <CompareBar
          mode={compareMode}
          onModeChange={setCompareMode}
          compared={compared}
          sendsToLabelary={target.kind === 'labelary'}
        />
      )}

      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-auto overscroll-none bg-muted"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setSelection(panelId, null)
          }
        }}
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
                  count: labels.length,
                })}
                remote={compared.labels.at(index)}
                compared={compared}
                panelId={panelId}
                label={label}
                scale={scale}
                selection={selection}
                lineStarts={starts}
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
        comparison={
          view === 'local' || target?.kind === 'panel' ? undefined : comparison
        }
        otherPanel={
          target?.kind === 'panel' && other.render
            ? {
                name: panelName(target.panelId),
                labelCount: other.render.result.labels.length,
              }
            : undefined
        }
      >
        <CompareMenu
          target={target}
          panelName={panelName}
          panels={panelIds
            .filter((id) => id !== panelId)
            .map((id) => ({ id, name: panelName(id) }))}
          onTargetChange={setCompareWith}
        />
        <ZoomMenu zoom={zoom} scale={scale} onZoomChange={setZoom} />
      </StatusLine>
    </section>
  )
}

/** Picks what to compare with; Labelary is never picked by default. */
function CompareMenu({
  target,
  panelName,
  panels,
  onTargetChange,
}: {
  target: CompareTarget | null
  panelName: (id: string) => string
  /** The other panels, in order. */
  panels: ReadonlyArray<{ id: string; name: string }>
  onTargetChange: (target: CompareTarget | null) => void
}) {
  const value =
    target === null
      ? 'nothing'
      : target.kind === 'labelary'
        ? 'labelary'
        : `panel:${target.panelId}`

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
          {target
            ? m.compare_target({
                name:
                  target.kind === 'labelary'
                    ? m.compare_labelary_title()
                    : panelName(target.panelId),
              })
            : m.compare()}
          <IconChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-60">
        <DropdownMenuLabel>{m.compare_with()}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) =>
            onTargetChange(
              next === 'labelary'
                ? { kind: 'labelary' }
                : next.startsWith('panel:')
                  ? { kind: 'panel', panelId: next.slice('panel:'.length) }
                  : null,
            )
          }
        >
          <DropdownMenuRadioItem value="nothing">
            {m.compare_nothing()}
          </DropdownMenuRadioItem>
          {panels.map(({ id, name }) => (
            <DropdownMenuRadioItem key={id} value={`panel:${id}`}>
              {name}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuRadioItem value="labelary">
            <span className="flex flex-col gap-0.5">
              {m.compare_labelary_title()}
              <span className="text-muted-foreground">
                {m.compare_labelary_hint()}
              </span>
            </span>
          </DropdownMenuRadioItem>
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

function CompareBar({
  mode,
  onModeChange,
  compared,
  sendsToLabelary,
}: {
  mode: CompareMode
  onModeChange: (mode: CompareMode) => void
  compared: Compared
  sendsToLabelary: boolean
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
      {mode === 'difference' ? (
        <DiffLegend
          onlyLocal={compared.onlyLocal}
          onlyRemote={compared.onlyRemote}
        />
      ) : sendsToLabelary ? (
        <p className="text-xs text-muted-foreground">{m.compare_notice()}</p>
      ) : null}
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

interface LabelFigureProps extends LabelSurfaceProps {
  view: View
  caption: string
  /** The label at the same position on the other side, if it has one. */
  remote: ComparedLabel | undefined
  compared: Compared
}

function LabelFigure({
  view,
  caption,
  remote,
  compared,
  ...surface
}: LabelFigureProps) {
  if (view === 'difference' && remote) {
    return (
      <DiffFigure
        caption={caption}
        remote={remote}
        remoteTitle={compared.remoteTitle}
        stale={compared.stale}
        {...surface}
      />
    )
  }

  const { label, scale } = surface
  const remoteClassName = cn(
    'transition-opacity',
    compared.stale && 'opacity-50',
  )
  const placeholder = (
    <div
      className="flex items-center justify-center border border-dashed p-4 text-center text-xs text-muted-foreground"
      style={{ width: label.width * scale, height: label.height * scale }}
    >
      {compared.placeholder}
    </div>
  )

  return (
    <figure className="flex flex-col items-center gap-2">
      {view === 'side-by-side' ? (
        <div className="flex items-start" style={{ gap: PAIR_GAP }}>
          <RenderColumn title={compared.localTitle}>
            <LabelSurface {...surface} />
          </RenderColumn>
          <RenderColumn title={compared.remoteTitle}>
            {remote ? (
              <RasterSurface
                image={remote.canvas}
                width={remote.width}
                height={remote.height}
                scale={scale}
                className={remoteClassName}
              />
            ) : (
              placeholder
            )}
          </RenderColumn>
        </div>
      ) : view === 'labelary' ? (
        // Labelary's label is fetched dot for dot at the local label's size,
        // so the local render's regions still line up for click-to-code.
        remote ? (
          <LabelSurface
            {...surface}
            image={remote.canvas}
            className={remoteClassName}
          />
        ) : (
          placeholder
        )
      ) : (
        <LabelSurface {...surface} />
      )}
      <figcaption className="text-xs text-muted-foreground">
        {view === 'difference'
          ? `${caption} · ${compared.placeholder}`
          : view === 'labelary'
            ? `${caption} · ${m.compare_labelary_title()}`
            : caption}
      </figcaption>
    </figure>
  )
}

function DiffFigure({
  caption,
  remote,
  remoteTitle,
  stale,
  ...surface
}: LabelSurfaceProps & {
  caption: string
  remote: ComparedLabel
  remoteTitle: string
  stale: boolean
}) {
  const { label, scale } = surface
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
  const className = cn('transition-opacity', stale && 'opacity-50')

  return (
    <figure className="flex flex-col items-center gap-2">
      {/* The overlay covers both labels, so a bigger remote label leaves
          nothing for this label's regions to line up with. */}
      {diff.canvas.width === label.width &&
      diff.canvas.height === label.height ? (
        <LabelSurface {...surface} image={diff.canvas} className={className} />
      ) : (
        <RasterSurface
          image={diff.canvas}
          width={diff.canvas.width}
          height={diff.canvas.height}
          scale={scale}
          className={className}
        />
      )}
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

/** A plain label image with nothing to click. */
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

interface LabelSurfaceProps {
  panelId: string
  label: Label
  /** Drawn in place of the label's own canvas, at the same size. */
  image?: HTMLCanvasElement
  scale: number
  selection: SourceSelection | null
  lineStarts: number[]
  className?: string
}

function LabelSurface({
  panelId,
  label,
  image,
  scale,
  selection,
  lineStarts: starts,
  className,
}: LabelSurfaceProps) {
  const canvasRef = useCanvasCopy(image ?? label.canvas)
  const selectedRef = useRef<SVGGElement>(null)
  const [hovered, setHovered] = useState<HighlightRegion>()

  const regions = label.highlightRegions
  const focusable = regions.filter(hasArea)
  const selected = findSelectedRegion(regions, selection)

  // Moving the cursor in the editor brings the matching field into view.
  useEffect(() => {
    if (selected && selection?.origin === 'editor') {
      selectedRef.current?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      })
    }
  }, [selected, selection])

  const pointToDots = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * label.width,
      y: ((event.clientY - rect.top) / rect.height) * label.height,
    }
  }

  const select = (region: HighlightRegion | undefined) =>
    setSelection(
      panelId,
      region
        ? {
            from: region.sourceSpan.start,
            to: region.sourceSpan.end,
            origin: 'preview',
          }
        : null,
    )

  const onKeyDown = (
    event: KeyboardEvent<SVGRectElement>,
    region: HighlightRegion,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      select(region)
    }
  }

  return (
    <div
      className={cn(
        'relative bg-white shadow-sm ring-1 ring-border',
        className,
      )}
      style={{ width: label.width * scale, height: label.height * scale }}
    >
      <canvas
        ref={canvasRef}
        width={label.width}
        height={label.height}
        aria-hidden
        className="absolute inset-0 size-full"
        style={{ imageRendering: scale > 1 ? 'pixelated' : 'auto' }}
      />
      <svg
        viewBox={`0 0 ${label.width} ${label.height}`}
        className="absolute inset-0 size-full overflow-visible"
        style={{ cursor: hovered ? 'pointer' : 'default' }}
        onPointerMove={(event) => {
          const { x, y } = pointToDots(event)
          setHovered(findHighlightRegionAtPoint(regions, x, y))
        }}
        onPointerLeave={() => setHovered(undefined)}
        onClick={(event) => {
          const { x, y } = pointToDots(event)
          select(findHighlightRegionAtPoint(regions, x, y))
        }}
      >
        {focusable.map((region, regionIndex) => (
          <rect
            key={regionIndex}
            x={region.x}
            y={region.y}
            width={region.width}
            height={region.height}
            fill="transparent"
            role="button"
            tabIndex={0}
            aria-label={m.region_label({
              type: region.type,
              line: lineAt(starts, region.sourceSpan.start),
            })}
            className="outline-none"
            onFocus={() => setHovered(region)}
            onBlur={() => setHovered(undefined)}
            onKeyDown={(event) => onKeyDown(event, region)}
          />
        ))}
        {hovered && hovered !== selected && (
          <RegionOutline region={hovered} variant="hover" />
        )}
        {selected && (
          <RegionOutline
            ref={selectedRef}
            region={selected}
            variant="selected"
          />
        )}
      </svg>
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

interface RegionOutlineProps {
  region: HighlightRegion
  variant: 'hover' | 'selected'
  ref?: React.Ref<SVGGElement>
}

/** Hover is dashed, selection is solid and filled, so colour is never the only cue. */
function RegionOutline({ region, variant, ref }: RegionOutlineProps) {
  const shapeProps = {
    vectorEffect: 'non-scaling-stroke' as const,
    strokeWidth: 2,
    strokeDasharray: variant === 'hover' ? '4 3' : undefined,
    className:
      variant === 'selected'
        ? 'fill-selection-soft stroke-selection'
        : 'fill-none stroke-selection',
  }

  let shape: React.ReactNode
  if (region.type === 'circle' && region.radius !== undefined) {
    shape = (
      <circle cx={region.x} cy={region.y} r={region.radius} {...shapeProps} />
    )
  } else if (region.type === 'ellipse' && hasArea(region)) {
    shape = (
      <ellipse
        cx={region.x + region.width / 2}
        cy={region.y + region.height / 2}
        rx={region.width / 2}
        ry={region.height / 2}
        {...shapeProps}
      />
    )
  } else if (hasArea(region)) {
    shape = (
      <rect
        x={region.x}
        y={region.y}
        width={region.width}
        height={region.height}
        {...shapeProps}
      />
    )
  } else {
    // A field origin with no drawn extent: mark the point itself.
    shape = (
      <>
        <circle cx={region.x} cy={region.y} r={12} {...shapeProps} />
        <path
          d={`M${region.x - 20} ${region.y}h40M${region.x} ${region.y - 20}v40`}
          {...shapeProps}
          strokeDasharray={undefined}
        />
      </>
    )
  }

  return (
    <g ref={ref} pointerEvents="none">
      {shape}
    </g>
  )
}

function StatusLine({
  panelId,
  render,
  isRendering,
  error,
  comparison,
  otherPanel,
  children,
}: LabelPreviewProps & {
  comparison?: Comparison
  /** The panel being compared with, once its render is available. */
  otherPanel?: { name: string; labelCount: number }
  /** Controls at the end of the line. */
  children?: React.ReactNode
}) {
  const settings = useSelector(
    editorStore,
    (state) => selectPanel(state, panelId)?.settings ?? DEFAULT_SETTINGS,
  )
  const labels = render?.result.labels ?? []
  const problems = render
    ? uniqueDiagnostics(render.result.diagnostics).filter(
        (diagnostic) => diagnostic.severity !== 'info',
      ).length
    : 0
  const first = labels.at(0)
  // The rendered size once there is one, else what the settings ask for.
  const size = first
    ? m.status_size({
        width: formatInches(first.width, first.printDensity),
        height: formatInches(first.height, first.printDensity),
        dpi: dpiFor(first.printDensity),
      })
    : m.status_size({
        width: settings.widthIn,
        height: settings.heightIn,
        dpi: dpiFor(settings.dpmm),
      })

  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t py-1 pr-1.5 pl-1.5 text-xs text-muted-foreground tabular-nums">
      <SettingsPopover panelId={panelId}>
        <Button variant="ghost" size="xs" className="text-muted-foreground">
          {size}
          <IconChevronDown data-icon="inline-end" />
        </Button>
      </SettingsPopover>
      <div
        role="status"
        aria-live="polite"
        className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1"
      >
        {error ? (
          <span className="text-destructive">
            {m.render_failed({ message: error.message })}
          </span>
        ) : null}
        {render && (
          <>
            <span>
              {labels.length === 1
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
        {comparison && (
          <ComparisonStatus
            comparison={comparison}
            localCount={labels.length}
          />
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
        {isRendering ? (
          <span className="ml-auto">{m.status_rendering()}</span>
        ) : comparison?.isFetching ? (
          <span className="ml-auto">{m.compare_loading()}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

function ComparisonStatus({
  comparison: { labelary, isStale, error, refetch },
  localCount,
}: {
  comparison: Comparison
  localCount: number
}) {
  if (error) {
    const message =
      error instanceof LabelaryError && error.status === 429
        ? m.compare_rate_limited()
        : m.compare_failed({ message: error.message })
    return (
      <span className="flex items-center gap-2">
        <span className="text-destructive">{message}</span>
        <Button variant="outline" size="xs" onClick={refetch}>
          {m.retry()}
        </Button>
      </span>
    )
  }
  if (labelary && !isStale && labelary.total !== localCount) {
    return (
      <span className="text-foreground">
        {m.compare_count({ count: labelary.total })}
      </span>
    )
  }
  return null
}

type SizedRegion = HighlightRegion & { width: number; height: number }

function hasArea(region: HighlightRegion): region is SizedRegion {
  return (
    region.type !== 'origin' &&
    region.width !== undefined &&
    region.height !== undefined &&
    region.width > 0 &&
    region.height > 0
  )
}

/**
 * For a preview click, the region whose span was clicked. For an editor
 * cursor, the tightest drawn region whose source contains the cursor.
 */
function findSelectedRegion(
  regions: readonly HighlightRegion[],
  selection: SourceSelection | null,
): HighlightRegion | undefined {
  if (!selection) return undefined

  if (selection.origin === 'preview') {
    const matches = regions.filter(
      (region) =>
        region.sourceSpan.start === selection.from &&
        region.sourceSpan.end === selection.to,
    )
    return matches.find((region) => region.type !== 'origin') ?? matches[0]
  }

  const cursor = selection.from
  let best: HighlightRegion | undefined
  let bestScore = Infinity
  for (const region of regions) {
    const { start, end } = region.sourceSpan
    if (cursor < start || cursor > end) continue
    // Prefer drawn fields over bare origins, a cursor inside the span over
    // one sitting just after it, then the shortest span.
    const score =
      (region.type === 'origin' ? 2e9 : 0) +
      (cursor === end ? 1e9 : 0) +
      (end - start)
    if (score < bestScore) {
      best = region
      bestScore = score
    }
  }
  return best
}

function formatInches(dots: number, dpmm: Label['printDensity']) {
  return Number(dotsToInches(dots, dpmm).toFixed(2))
}
