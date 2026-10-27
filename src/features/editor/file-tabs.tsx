import { useEffect, useRef } from 'react'
import { useSelector } from '@tanstack/react-store'
import { IconX } from '@tabler/icons-react'

import { Button } from '#/components/ui/button'
import { TabsList, TabsTrigger } from '#/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { m } from '#/paraglide/messages'
import { closeFile, editorStore, selectFile } from './store'

export function FileTabs() {
  const ids = useSelector(editorStore, (state) => state.openFileIds)
  const active = useSelector(editorStore, (state) => state.activeFileId)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-state="active"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const close = (id: string) => {
    closeFile(id)
    // Removing the focused tab must not drop keyboard focus on the document.
    requestAnimationFrame(() => {
      const next = listRef.current?.querySelector<HTMLElement>(
        '[data-state="active"]',
      )
      if (next) next.focus()
      else document.getElementById('new-file')?.focus()
    })
  }

  return (
    <div
      ref={listRef}
      className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <TabsList
        aria-label={m.open_tabs()}
        variant="line"
        className="gap-1 p-0 group-data-horizontal/tabs:h-9"
      >
        {ids.map((id) => (
          <FileTab key={id} id={id} onClose={() => close(id)} />
        ))}
      </TabsList>
    </div>
  )
}

function FileTab({ id, onClose }: { id: string; onClose: () => void }) {
  const name = useSelector(
    editorStore,
    (state) => `${selectFile(state, id)?.fileName ?? ''}.zpl`,
  )
  const active = useSelector(editorStore, (state) => state.activeFileId === id)
  return (
    <div
      className={`flex h-8 max-w-44 shrink-0 items-center border-b-2 ${active ? 'border-foreground bg-muted' : 'border-transparent'}`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <TabsTrigger
            value={id}
            className="h-full min-w-0 flex-1 px-2.5 font-normal after:hidden"
            onKeyDown={(event) => {
              if (event.key === 'Delete') {
                event.preventDefault()
                onClose()
              }
            }}
          >
            <span className="truncate">{name}</span>
          </TabsTrigger>
        </TooltipTrigger>
        <TooltipContent>{name}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={m.close_file_tab({ name })}
            className="mr-0.5 shrink-0 text-foreground/80 hover:bg-accent hover:text-foreground"
            onClick={onClose}
          >
            <IconX aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{m.close_file_tab({ name })}</TooltipContent>
      </Tooltip>
    </div>
  )
}
