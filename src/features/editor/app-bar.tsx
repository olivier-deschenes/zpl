import {
  IconChevronDown,
  IconDots,
  IconGitCompare,
  IconPlus,
  IconZoomScan,
} from '@tabler/icons-react'
import { shallow, useSelector } from '@tanstack/react-store'

import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Toggle } from '#/components/ui/toggle'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { m } from '#/paraglide/messages'
import { FileLibrary } from './file-library'
import { FileTabs } from './file-tabs'
import {
  MAX_PANELS,
  addFile,
  editorStore,
  selectFile,
  setSyncZoom,
} from './store'

/** Two open files to compare, in page order. */
export type ComparePair = readonly [string, string]
const NO_PAIR = 'nothing'

interface CompareProps {
  compare: ComparePair | null
  onCompareChange: (compare: ComparePair | null) => void
}

interface AppBarProps extends CompareProps {
  libraryOpen: boolean
  onLibraryOpenChange: (open: boolean) => void
}

/** Files and workspace controls share the existing single navigation row. */
export function AppBar({
  libraryOpen,
  onLibraryOpenChange,
  ...compareProps
}: AppBarProps) {
  return (
    <header className="flex h-11 min-w-0 shrink-0 items-center gap-1 border-b px-2 sm:pl-3">
      <img
        src="/logo.svg"
        alt=""
        width={20}
        height={20}
        className="mr-1 size-5 shrink-0 dark:invert"
      />
      <h1 className="sr-only">{m.app_title()}</h1>
      <FileLibrary open={libraryOpen} onOpenChange={onLibraryOpenChange} />
      <FileTabs />
      <NewFileButton />
      <div className="ml-1 hidden shrink-0 items-center gap-1 border-l pl-2 xl:flex">
        <SyncZoomToggle />
        <CompareControl {...compareProps} />
      </div>
      <div className="shrink-0 xl:hidden">
        <ViewMenu {...compareProps} />
      </div>
    </header>
  )
}

function NewFileButton() {
  const full = useSelector(
    editorStore,
    (state) => state.openFileIds.length >= MAX_PANELS,
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0" tabIndex={full ? 0 : undefined}>
          <Button
            id="new-file"
            variant="ghost"
            size="icon-sm"
            disabled={full}
            aria-label={m.new_file()}
            onClick={() => addFile()}
          >
            <IconPlus />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {full ? m.open_file_limit({ count: MAX_PANELS }) : m.new_file()}
      </TooltipContent>
    </Tooltip>
  )
}

function SyncZoomToggle() {
  const syncZoom = useSelector(editorStore, (state) => state.syncZoom)
  const several = useSelector(
    editorStore,
    (state) => state.openFileIds.length > 1,
  )
  if (!several) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          variant="outline"
          size="sm"
          pressed={syncZoom}
          onPressedChange={setSyncZoom}
          aria-label={m.sync_zoom()}
        >
          <IconZoomScan />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{m.sync_zoom_hint()}</TooltipContent>
    </Tooltip>
  )
}

function useComparePairs() {
  const ids = useSelector(editorStore, (state) => state.openFileIds)
  const names = useSelector(
    editorStore,
    (state) =>
      state.openFileIds.map(
        (id) => `${selectFile(state, id)?.fileName ?? ''}.zpl`,
      ),
    { compare: shallow },
  )
  return ids.flatMap((first, index) =>
    ids.slice(index + 1).map((second, offset) => ({
      pair: [first, second] as const,
      value: `${first} ${second}`,
      label: m.compare_pair({
        first: names[index],
        second: names[index + offset + 1],
      }),
    })),
  )
}

function CompareOptions({ compare, onCompareChange }: CompareProps) {
  const pairs = useComparePairs()
  return (
    <DropdownMenuRadioGroup
      value={compare?.join(' ') ?? NO_PAIR}
      onValueChange={(value) =>
        onCompareChange(
          pairs.find((pair) => pair.value === value)?.pair ?? null,
        )
      }
    >
      <DropdownMenuRadioItem value={NO_PAIR}>
        {m.compare_nothing()}
      </DropdownMenuRadioItem>
      {pairs.map(({ value, label }) => (
        <DropdownMenuRadioItem
          key={value}
          value={value}
          className="break-words"
        >
          {label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

function CompareControl(props: CompareProps) {
  const pairs = useComparePairs()
  if (pairs.length < 2)
    return (
      <Tooltip open={pairs.length === 0 ? undefined : false}>
        <TooltipTrigger asChild>
          <span tabIndex={pairs.length === 0 ? 0 : undefined}>
            <Toggle
              variant="outline"
              size="sm"
              disabled={pairs.length === 0}
              pressed={props.compare !== null}
              onPressedChange={(pressed) =>
                props.onCompareChange(pressed ? pairs[0].pair : null)
              }
            >
              <IconGitCompare />
              {m.compare()}
            </Toggle>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {pairs.length ? m.compare_panels() : m.compare_add_panel_hint()}
        </TooltipContent>
      </Tooltip>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Toggle variant="outline" size="sm" pressed={props.compare !== null}>
          <IconGitCompare />
          {m.compare()}
          <IconChevronDown />
        </Toggle>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-80">
        <DropdownMenuLabel>{m.compare_panels()}</DropdownMenuLabel>
        <CompareOptions {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ViewMenu(props: CompareProps) {
  const syncZoom = useSelector(editorStore, (state) => state.syncZoom)
  const several = useSelector(
    editorStore,
    (state) => state.openFileIds.length > 1,
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={m.view_options()}>
          <IconDots />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuCheckboxItem
          checked={syncZoom}
          disabled={!several}
          onCheckedChange={setSyncZoom}
        >
          {m.sync_zoom()}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!several}>
            <IconGitCompare />
            {m.compare()}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-w-72">
            <CompareOptions {...props} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
