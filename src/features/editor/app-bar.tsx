import {
  IconChevronDown,
  IconGitCompare,
  IconPlus,
  IconZoomScan,
} from '@tabler/icons-react'
import { shallow, useSelector } from '@tanstack/react-store'

import { Button } from '#/components/ui/button'
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
import { m } from '#/paraglide/messages'
import {
  MAX_PANELS,
  addPanel,
  editorStore,
  setExplain,
  setSyncZoom,
} from './store'

/** Two panels to compare, in page order. */
export type ComparePair = readonly [string, string]

/** The compare menu's value for comparing nothing; never a pair. */
const NO_PAIR = 'nothing'

interface AppBarProps {
  /** The pair being compared, if any. */
  compare: ComparePair | null
  onCompareChange: (compare: ComparePair | null) => void
}

/** Controls that apply to every panel, above them all. */
export function AppBar({ compare, onCompareChange }: AppBarProps) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b pr-2 pl-3">
      <img
        src="/logo.svg"
        alt=""
        width={20}
        height={20}
        className="size-5 shrink-0 dark:invert"
      />
      <h1 className="truncate text-xs font-medium max-sm:sr-only">
        {m.app_title()}
      </h1>
      <div className="ml-auto flex items-center gap-1">
        <ExplainToggle />
        <SyncZoomToggle />
        <CompareControl compare={compare} onCompareChange={onCompareChange} />
        <Separator orientation="vertical" className="mx-1 my-3" />
        <AddPanelButton />
      </div>
    </header>
  )
}

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

/** Only shown once there is more than one preview to keep in step. */
function SyncZoomToggle() {
  const syncZoom = useSelector(editorStore, (state) => state.syncZoom)
  const several = useSelector(editorStore, (state) => state.panels.length > 1)
  if (!several) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          variant="outline"
          size="sm"
          pressed={syncZoom}
          onPressedChange={setSyncZoom}
        >
          <IconZoomScan />
          <span className="max-sm:sr-only">{m.sync_zoom()}</span>
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{m.sync_zoom_hint()}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Compares the two panels in one press, or picks which two when there are
 * more.
 */
function CompareControl({ compare, onCompareChange }: AppBarProps) {
  const panelIds = useSelector(
    editorStore,
    (state) => state.panels.map((panel) => panel.id),
    { compare: shallow },
  )
  const name = (id: string) =>
    m.panel_title({ index: panelIds.indexOf(id) + 1 })

  if (panelIds.length < 2) {
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

  if (panelIds.length === 2) {
    const [first, second] = panelIds
    return (
      <Toggle
        variant="outline"
        size="sm"
        pressed={compare !== null}
        onPressedChange={(pressed) =>
          onCompareChange(pressed ? [first, second] : null)
        }
      >
        <IconGitCompare />
        {m.compare()}
      </Toggle>
    )
  }

  const pairs = panelIds.flatMap((first, index) =>
    panelIds.slice(index + 1).map((second) => [first, second] as const),
  )
  const pairKey = ([first, second]: ComparePair) => `${first} ${second}`
  const pairName = ([first, second]: ComparePair) =>
    m.compare_pair({ first: name(first), second: name(second) })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Toggle variant="outline" size="sm" pressed={compare !== null}>
          <IconGitCompare />
          {compare ? pairName(compare) : m.compare()}
          <IconChevronDown />
        </Toggle>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{m.compare_panels()}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={compare ? pairKey(compare) : NO_PAIR}
          onValueChange={(value) =>
            onCompareChange(
              pairs.find((pair) => pairKey(pair) === value) ?? null,
            )
          }
        >
          <DropdownMenuRadioItem value={NO_PAIR}>
            {m.compare_nothing()}
          </DropdownMenuRadioItem>
          {pairs.map((pair) => (
            <DropdownMenuRadioItem key={pairKey(pair)} value={pairKey(pair)}>
              {pairName(pair)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Opens an empty panel after the last one, sized like it. */
function AddPanelButton() {
  const lastId = useSelector(editorStore, (state) => state.panels.at(-1)?.id)
  const full = useSelector(
    editorStore,
    (state) => state.panels.length >= MAX_PANELS,
  )

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={full || !lastId}
      onClick={() => lastId && addPanel(lastId)}
    >
      <IconPlus data-icon="inline-start" />
      <span className="max-sm:sr-only">{m.add_panel()}</span>
    </Button>
  )
}
