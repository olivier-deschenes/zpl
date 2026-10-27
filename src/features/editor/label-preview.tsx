import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { IconAlertTriangle, IconMinus, IconPlus } from '@tabler/icons-react'
import { useSelector } from '@tanstack/react-store'
import { cn } from 'cn'

import { Button } from '#/components/ui/button'
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
  labelDots,
} from '#/lib/zpl/settings'
import type { LabelSettings, ZplSize } from '#/lib/zpl/settings'
import { m } from '#/paraglide/messages'
import { getLocale } from '#/paraglide/runtime'
import {
  editorStore,
  selectFile,
  setPreviewZoom,
  setSettings,
  zoomStore,
} from './store'
import type { PreviewZoom } from './store'
import { useOtherPanelRender } from './use-label-render'
import type { LabelRender } from './use-label-render'

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
const MIN_ZOOM = ZOOM_STEPS[0]
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]
/** How fast pinching or ⌘/Ctrl+scrolling zooms, per pixel scrolled. */
const WHEEL_ZOOM_RATE = 0.01
/** The most one wheel event zooms, as a power of e, so a notch can't leap. */
const MAX_ZOOM_STEP = 0.3
/** Marks what stays under the pointer while zooming. */
const ZOOM_ANCHOR = '[data-zoom-anchor]'
const VIEWPORT_PADDING = 24
/** Between the two labels when comparing side by side. */
const PAIR_GAP = 16
/** A figure's caption line and the gap above it. */
const CAPTION_HEIGHT = 16 + 8
/** A side-by-side column's title line and the gap below it. */
const COLUMN_TITLE_HEIGHT = 16 + 6

type CompareMode = 'side-by-side' | 'difference'
/** The panel's labels alone, or compared with another panel's. */
type View = 'single' | CompareMode

/** Hears one preview scroll, to scroll the others along while zoom is synced. */
type ScrollListener = (source: string, left: number, top: number) => void
const scrollListeners = new Set<ScrollListener>()

/** Where the pointer was over an element, to keep it there while zooming. */
interface ZoomAnchor {
  element: Element
  /** The point as a fraction of the element's size. */
  fx: number
  fy: number
  /** The pointer, from the viewport's corner. */
  x: number
  y: number
}

/** Safari reports trackpad pinches as gestures rather than wheel events. */
interface GestureEvent extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

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
  /** The panel to compare with, if any. */
  compareTarget: string | null
}

export function LabelPreview({
  panelId,
  render,
  isRendering,
  error,
  onRetry,
  compareTarget: target,
}: LabelPreviewProps) {
  const headingId = useId()
  const zoom = useSelector(zoomStore, (zooms) => zooms[panelId] ?? 'fit')
  const syncZoom = useSelector(editorStore, (state) => state.syncZoom)
  const [viewportRef, viewport, viewportElement] =
    useElementSize<HTMLDivElement>()
  const localName = useSelector(
    editorStore,
    (state) => `${selectFile(state, panelId)?.fileName ?? ''}.zpl`,
  )
  const remoteName = useSelector(editorStore, (state) =>
    target ? `${selectFile(state, target)?.fileName ?? ''}.zpl` : '',
  )
  const [compareMode, setCompareMode] = useState<CompareMode>('side-by-side')
  const view: View = target ? compareMode : 'single'
  const other = useOtherPanelRender(target ?? undefined)

  const compared: Compared | undefined = target
    ? {
        labels: other.render?.labels ?? [],
        stale: other.isStale,
        placeholder: m.compare_no_panel_label({ name: remoteName }),
        localTitle: localName,
        remoteTitle: remoteName,
        onlyLocal: m.diff_only({ name: localName }),
        onlyRemote: m.diff_only({ name: remoteName }),
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

  // Zooms not yet rendered: events can arrive faster than renders, and each
  // builds on the last.
  const pendingZoom = useRef<{
    scale: number
    anchor: ZoomAnchor | undefined
  } | null>(null)

  const zoomAt = (
    factor: number,
    clientX: number,
    clientY: number,
    pointerTarget: EventTarget | null,
  ) => {
    if (!viewportElement || labels.length === 0) return
    const from = pendingZoom.current?.scale ?? scale
    const to = Math.min(Math.max(from * factor, MIN_ZOOM), MAX_ZOOM)
    if (to === from) return

    const box = viewportElement.getBoundingClientRect()
    const x = clientX - box.left
    const y = clientY - box.top
    const pending = pendingZoom.current?.anchor
    let anchor = pending && { ...pending, x, y }
    if (!anchor) {
      const element =
        (pointerTarget instanceof Element &&
          pointerTarget.closest(ZOOM_ANCHOR)) ||
        viewportElement.firstElementChild
      if (element) {
        const rect = element.getBoundingClientRect()
        anchor = {
          element,
          fx: (clientX - rect.left) / rect.width,
          fy: (clientY - rect.top) / rect.height,
          x,
          y,
        }
      }
    }
    pendingZoom.current = { scale: to, anchor }
    setPreviewZoom(panelId, to)
  }

  const pinching = useRef(false)
  const onWheel = useEffectEvent((event: WheelEvent) => {
    // A trackpad's scroll looks just like a mouse wheel's, so plain scrolling
    // scrolls. Browsers report a pinch as ctrl+wheel; ⌘+wheel zooms as well.
    if (!(event.ctrlKey || event.metaKey) || pinching.current) return
    event.preventDefault()
    const pixels =
      event.deltaY *
      (event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? viewport.height
          : 1)
    const step = -pixels * WHEEL_ZOOM_RATE
    zoomAt(
      Math.exp(Math.min(Math.max(step, -MAX_ZOOM_STEP), MAX_ZOOM_STEP)),
      event.clientX,
      event.clientY,
      event.target,
    )
  })
  const onGesture = useEffectEvent((event: GestureEvent, factor: number) => {
    zoomAt(factor, event.clientX, event.clientY, event.target)
  })

  useEffect(() => {
    if (!viewportElement) return
    // Safari's gesture scale counts from the start of the pinch.
    let gestureScale = 1
    const wheel = (event: WheelEvent) => onWheel(event)
    const gestureStart = (event: Event) => {
      event.preventDefault()
      pinching.current = true
      gestureScale = 1
    }
    const gestureChange = (event: Event) => {
      event.preventDefault()
      const gesture = event as GestureEvent
      onGesture(gesture, gesture.scale / gestureScale)
      gestureScale = gesture.scale
    }
    const gestureEnd = (event: Event) => {
      event.preventDefault()
      pinching.current = false
    }
    // Not passive, so the page itself doesn't scroll or zoom too.
    viewportElement.addEventListener('wheel', wheel, { passive: false })
    viewportElement.addEventListener('gesturestart', gestureStart)
    viewportElement.addEventListener('gesturechange', gestureChange)
    viewportElement.addEventListener('gestureend', gestureEnd)
    return () => {
      viewportElement.removeEventListener('wheel', wheel)
      viewportElement.removeEventListener('gesturestart', gestureStart)
      viewportElement.removeEventListener('gesturechange', gestureChange)
      viewportElement.removeEventListener('gestureend', gestureEnd)
    }
  }, [viewportElement])

  // Where this pane was scrolled to by code rather than by the user, which it
  // doesn't pass on: a pane that can't scroll as far would pull the others
  // back.
  const ignoredScroll = useRef<{ left: number; top: number } | null>(null)
  const scrollTo = (left: number, top: number) => {
    if (!viewportElement) return
    const { scrollLeft, scrollTop } = viewportElement
    viewportElement.scrollLeft = left
    viewportElement.scrollTop = top
    const moved =
      viewportElement.scrollLeft !== scrollLeft ||
      viewportElement.scrollTop !== scrollTop
    ignoredScroll.current = moved
      ? { left: viewportElement.scrollLeft, top: viewportElement.scrollTop }
      : null
  }
  const onSyncedScroll = useEffectEvent(
    (source: string, left: number, top: number) => {
      if (source !== panelId) scrollTo(left, top)
    },
  )

  useEffect(() => {
    if (!viewportElement || !syncZoom) return
    const scroll = () => {
      const { scrollLeft: left, scrollTop: top } = viewportElement
      const ignored = ignoredScroll.current
      ignoredScroll.current = null
      if (ignored?.left === left && ignored.top === top) return
      for (const listener of scrollListeners) listener(panelId, left, top)
    }
    const listener: ScrollListener = (source, left, top) =>
      onSyncedScroll(source, left, top)
    scrollListeners.add(listener)
    viewportElement.addEventListener('scroll', scroll, { passive: true })
    return () => {
      scrollListeners.delete(listener)
      viewportElement.removeEventListener('scroll', scroll)
    }
  }, [viewportElement, syncZoom, panelId])

  // Keeps what was under the pointer there, or else what was in the middle
  // of the pane, as labels grow and shrink. Only the pane being zoomed
  // passes its scroll on; the others follow it.
  const shownScale = useRef(scale)
  useLayoutEffect(() => {
    const previous = shownScale.current
    shownScale.current = scale
    const anchor = pendingZoom.current?.anchor
    pendingZoom.current = null
    if (!viewportElement || previous === scale) return

    if (anchor?.element.isConnected) {
      const box = viewportElement.getBoundingClientRect()
      const rect = anchor.element.getBoundingClientRect()
      viewportElement.scrollLeft +=
        rect.left + anchor.fx * rect.width - box.left - anchor.x
      viewportElement.scrollTop +=
        rect.top + anchor.fy * rect.height - box.top - anchor.y
      return
    }
    const ratio = scale / previous
    const { clientWidth, clientHeight, scrollLeft, scrollTop } = viewportElement
    scrollTo(
      (scrollLeft + clientWidth / 2) * ratio - clientWidth / 2,
      (scrollTop + clientHeight / 2) * ratio - clientHeight / 2,
    )
  }, [scale, viewportElement])

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
                name: remoteName,
                labelCount: other.render.labels.length,
              }
            : undefined
        }
      >
        <ZoomControls
          zoom={zoom}
          scale={scale}
          onZoomChange={(next) => setPreviewZoom(panelId, next)}
        />
      </StatusLine>
    </section>
  )
}

function ZoomControls({
  zoom,
  scale,
  onZoomChange,
}: {
  zoom: PreviewZoom
  /** The zoom in effect, which fitting the pane works out. */
  scale: number
  onZoomChange: (zoom: PreviewZoom) => void
}) {
  const percent = Math.round(scale * 100)
  const larger = ZOOM_STEPS.find((step) => step > scale * 1.01)
  const smaller = ZOOM_STEPS.filter((step) => step < scale * 0.99).at(-1)

  return (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={m.zoom_out()}
            className="text-muted-foreground"
            disabled={smaller === undefined}
            onClick={() => smaller && onZoomChange(smaller)}
          >
            <IconMinus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{m.zoom_out()}</TooltipContent>
      </Tooltip>
      <span
        aria-label={m.zoom_level({ percent })}
        className="min-w-10 text-center"
      >
        {m.zoom_percent({ percent })}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={m.zoom_in()}
            className="text-muted-foreground"
            disabled={larger === undefined}
            onClick={() => larger && onZoomChange(larger)}
          >
            <IconPlus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{m.zoom_in()}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            aria-pressed={zoom === 'fit'}
            className="text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
            onClick={() => onZoomChange('fit')}
          >
            {m.zoom_fit_short()}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{m.zoom_fit()}</TooltipContent>
      </Tooltip>
    </div>
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
                data-zoom-anchor
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
      data-zoom-anchor
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
}: Omit<LabelPreviewProps, 'compareTarget'> & {
  /** The panel being compared with, once its render is available. */
  otherPanel?: { name: string; labelCount: number }
  /** Controls at the end of the line. */
  children?: React.ReactNode
}) {
  const settings = useSelector(
    editorStore,
    (state) => selectFile(state, panelId)?.settings ?? DEFAULT_SETTINGS,
  )
  const labels = render?.labels ?? []
  const problems = render?.warnings.length ?? 0
  const zplSize = render ? zplSizeSettings(render.zplSize, settings) : null

  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t py-1 pr-1.5 pl-3 text-xs text-muted-foreground tabular-nums">
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
