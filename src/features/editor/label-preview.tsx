import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import {
  IconArrowsHorizontal,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react'
import { useSelector } from '@tanstack/react-store'
import { findHighlightRegionAtPoint } from 'zplr/web'

import { Button } from '#/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { useElementWidth } from '#/hooks/use-element-width'
import { dotsToInches, dpiFor } from '#/lib/zpl/render'
import type { HighlightRegion, RenderedLabel } from '#/lib/zpl/render'
import { m } from '#/paraglide/messages'
import { lineAt, lineStarts, uniqueDiagnostics } from './diagnostics'
import { editorStore, setSelection } from './store'
import type { SourceSelection } from './store'
import type { LabelRender } from './use-label-render'

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
const VIEWPORT_PADDING = 24

type Label = RenderedLabel<HTMLCanvasElement>

interface LabelPreviewProps {
  render: LabelRender | undefined
  isRendering: boolean
  error: Error | null
}

export function LabelPreview({
  render,
  isRendering,
  error,
}: LabelPreviewProps) {
  const selection = useSelector(editorStore, (state) => state.selection)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [viewportRef, viewportWidth] = useElementWidth<HTMLDivElement>()

  const labels = render?.result.labels ?? []
  const widest = Math.max(1, ...labels.map((label) => label.width))
  const fitScale = Math.max(
    ZOOM_STEPS[0],
    (viewportWidth - VIEWPORT_PADDING * 2) / widest,
  )
  const scale = zoom === 'fit' ? fitScale : zoom
  const starts = useMemo(() => lineStarts(render?.source ?? ''), [render])

  const zoomIn = () =>
    setZoom(ZOOM_STEPS.find((step) => step > scale * 1.01) ?? scale)
  const zoomOut = () =>
    setZoom(ZOOM_STEPS.filter((step) => step < scale * 0.99).at(-1) ?? scale)

  return (
    <section
      aria-labelledby="preview-heading"
      className="flex h-full min-w-0 flex-col"
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3">
        <h2 id="preview-heading" className="text-xs font-medium">
          {m.preview_label()}
        </h2>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {m.zoom_level({ percent: Math.round(scale * 100) })}
          </span>
          <ZoomButton label={m.zoom_out()} onClick={zoomOut}>
            <IconZoomOut />
          </ZoomButton>
          <ZoomButton label={m.zoom_in()} onClick={zoomIn}>
            <IconZoomIn />
          </ZoomButton>
          <ZoomButton
            label={m.zoom_fit()}
            onClick={() => setZoom('fit')}
            pressed={zoom === 'fit'}
          >
            <IconArrowsHorizontal />
          </ZoomButton>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-auto bg-muted"
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelection(null)
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
              <LabelView
                key={index}
                label={label}
                index={index}
                count={labels.length}
                scale={scale}
                selection={selection}
                lineStarts={starts}
              />
            ))}
          </div>
        )}
      </div>

      <StatusLine render={render} isRendering={isRendering} error={error} />
    </section>
  )
}

interface LabelViewProps {
  label: Label
  index: number
  count: number
  scale: number
  selection: SourceSelection | null
  lineStarts: number[]
}

function LabelView({
  label,
  index,
  count,
  scale,
  selection,
  lineStarts: starts,
}: LabelViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const selectedRef = useRef<SVGGElement>(null)
  const [hovered, setHovered] = useState<HighlightRegion>()

  const regions = label.highlightRegions
  const focusable = regions.filter(hasArea)
  const selected = findSelectedRegion(regions, selection)

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, label.width, label.height)
    context.drawImage(label.canvas, 0, 0)
  }, [label])

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
    <figure className="flex flex-col items-center gap-2">
      <div
        className="relative bg-white shadow-sm ring-1 ring-border"
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
      <figcaption className="text-xs text-muted-foreground">
        {m.label_caption({ index: index + 1, count })}
      </figcaption>
    </figure>
  )
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

function StatusLine({ render, isRendering, error }: LabelPreviewProps) {
  const settings = useSelector(editorStore, (state) => state.settings)
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
      {isRendering && <span className="ml-auto">{m.status_rendering()}</span>}
    </div>
  )
}

function ZoomButton({
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
