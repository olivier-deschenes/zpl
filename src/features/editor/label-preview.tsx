import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import {
  IconArrowsMaximize,
  IconGitCompare,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react'
import { useSelector } from '@tanstack/react-store'
import { cn } from 'cn'
import { findHighlightRegionAtPoint } from 'zplr/web'

import { Button } from '#/components/ui/button'
import { Separator } from '#/components/ui/separator'
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
import { DEFAULT_SETTINGS, dotsToInches, dpiFor } from '#/lib/zpl/render'
import type { HighlightRegion, RenderedLabel } from '#/lib/zpl/render'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import { lineAt, lineStarts, uniqueDiagnostics } from './diagnostics'
import { editorStore, selectPanel, setSelection } from './store'
import type { PreviewSource, SourceSelection } from './store'
import type { LabelRender } from './use-label-render'
import { useLabelaryRender } from './use-labelary-render'

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
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
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [viewportRef, viewport] = useElementSize<HTMLDivElement>()
  // Off on every load: comparing sends the ZPL to labelary.com.
  const [compare, setCompare] = useState(false)
  const [compareMode, setCompareMode] = useState<CompareMode>('side-by-side')
  const previewSource = useSelector(editorStore, (state) => state.previewSource)
  const view: View = compare ? compareMode : previewSource
  const comparison = useLabelaryRender(render, view !== 'local')
  const { labelary } = comparison

  // Views drawing Labelary over the local render's regions keep to the
  // render its labels were fetched for, so the two always line up while a
  // newer one is on its way.
  const shown =
    (view === 'difference' || view === 'labelary') && labelary
      ? labelary.local
      : render
  const labels = shown?.result.labels ?? []
  const widest = Math.max(1, ...labels.map((label) => label.width))
  const tallest = Math.max(1, ...labels.map((label) => label.height))
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
  const remotePlaceholder = labelary
    ? m.compare_no_label()
    : comparison.error
      ? m.compare_unavailable()
      : m.compare_loading()

  const zoomIn = () =>
    setZoom(ZOOM_STEPS.find((step) => step > scale * 1.01) ?? scale)
  const zoomOut = () =>
    setZoom(ZOOM_STEPS.filter((step) => step < scale * 0.99).at(-1) ?? scale)

  return (
    <section
      aria-labelledby={headingId}
      className="flex h-full min-w-0 flex-col"
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
        <h3 id={headingId} className="truncate text-xs font-medium">
          {m.preview_label()}
        </h3>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {m.zoom_level({ percent: Math.round(scale * 100) })}
          </span>
          <HeaderButton label={m.zoom_out()} onClick={zoomOut}>
            <IconZoomOut />
          </HeaderButton>
          <HeaderButton label={m.zoom_in()} onClick={zoomIn}>
            <IconZoomIn />
          </HeaderButton>
          <HeaderButton
            label={m.zoom_fit()}
            onClick={() => setZoom('fit')}
            pressed={zoom === 'fit'}
          >
            <IconArrowsMaximize />
          </HeaderButton>
          <Separator orientation="vertical" className="mx-1 h-4" />
          <HeaderButton
            label={m.compare_labelary()}
            onClick={() => setCompare(!compare)}
            pressed={compare}
          >
            <IconGitCompare />
          </HeaderButton>
        </div>
      </div>

      {compare && (
        <CompareBar mode={compareMode} onModeChange={setCompareMode} />
      )}

      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-auto bg-muted"
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
                remote={labelary?.labels[index]}
                remoteStale={comparison.isStale}
                remotePlaceholder={remotePlaceholder}
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
        comparison={view === 'local' ? undefined : comparison}
      />
    </section>
  )
}

function CompareBar({
  mode,
  onModeChange,
}: {
  mode: CompareMode
  onModeChange: (mode: CompareMode) => void
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
        <DiffLegend />
      ) : (
        <p className="text-xs text-muted-foreground">{m.compare_notice()}</p>
      )}
    </div>
  )
}

function DiffLegend() {
  const entries = [
    [DIFF_COLORS.both, m.diff_both()],
    [DIFF_COLORS.onlyA, m.diff_only_editor()],
    [DIFF_COLORS.onlyB, m.diff_only_labelary()],
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
  remote: LabelaryLabel | undefined
  /** The Labelary label is for older source and is being replaced. */
  remoteStale: boolean
  /** Shown in place of a missing Labelary label. */
  remotePlaceholder: string
}

function LabelFigure({
  view,
  caption,
  remote,
  remoteStale,
  remotePlaceholder,
  ...surface
}: LabelFigureProps) {
  if (view === 'difference' && remote) {
    return (
      <DiffFigure
        caption={caption}
        remote={remote}
        stale={remoteStale}
        {...surface}
      />
    )
  }

  const { label, scale } = surface
  const remoteClassName = cn('transition-opacity', remoteStale && 'opacity-50')
  const placeholder = (
    <div
      className="flex items-center justify-center border border-dashed p-4 text-center text-xs text-muted-foreground"
      style={{ width: label.width * scale, height: label.height * scale }}
    >
      {remotePlaceholder}
    </div>
  )

  return (
    <figure className="flex flex-col items-center gap-2">
      {view === 'side-by-side' ? (
        <div className="flex items-start" style={{ gap: PAIR_GAP }}>
          <RenderColumn title={m.compare_editor()}>
            <LabelSurface {...surface} />
          </RenderColumn>
          <RenderColumn title={m.compare_labelary_title()}>
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
          ? `${caption} · ${remotePlaceholder}`
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
  stale,
  ...surface
}: LabelSurfaceProps & {
  caption: string
  remote: LabelaryLabel
  stale: boolean
}) {
  const local = surface.label.canvas
  const diff = useMemo(() => drawInkDiff(local, remote.canvas), [local, remote])
  const summary =
    diff.differing === 0
      ? m.diff_identical()
      : m.diff_summary({ percent: formatPercent(diff.differing / diff.inked) })

  return (
    <figure className="flex flex-col items-center gap-2">
      <LabelSurface
        {...surface}
        image={diff.canvas}
        className={cn('transition-opacity', stale && 'opacity-50')}
      />
      <figcaption className="text-xs text-muted-foreground">
        {caption} · {summary}
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
}: LabelPreviewProps & { comparison?: Comparison }) {
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

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5 text-xs text-muted-foreground tabular-nums"
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
          {first && (
            <span>
              {m.status_size({
                width: formatInches(first.width, first.printDensity),
                height: formatInches(first.height, first.printDensity),
                dpi: dpiFor(first.printDensity),
              })}
            </span>
          )}
          <span className={problems > 0 ? 'text-foreground' : undefined}>
            {problems === 0
              ? m.status_no_problems()
              : problems === 1
                ? m.status_one_problem()
                : m.status_many_problems({ count: problems })}
          </span>
        </>
      )}
      {!render && !error && (
        <span>
          {m.status_size({
            width: settings.widthIn,
            height: settings.heightIn,
            dpi: dpiFor(settings.dpmm),
          })}
        </span>
      )}
      {comparison && (
        <ComparisonStatus comparison={comparison} localCount={labels.length} />
      )}
      {isRendering ? (
        <span className="ml-auto">{m.status_rendering()}</span>
      ) : comparison?.isFetching ? (
        <span className="ml-auto">{m.compare_loading()}</span>
      ) : null}
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

function HeaderButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string
  onClick: () => void
  pressed?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className="aria-pressed:bg-muted"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
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
