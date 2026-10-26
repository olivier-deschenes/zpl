import { IconPlus } from '@tabler/icons-react'
import { useSelector } from '@tanstack/react-store'

import { Button } from '#/components/ui/button'
import { m } from '#/paraglide/messages'
import { MAX_PANELS, addPanel, editorStore } from './store'

/** A full-height strip after the last panel that opens another one. */
export function AddPanelRail() {
  const lastId = useSelector(editorStore, (state) => state.panels.at(-1)?.id)
  const full = useSelector(
    editorStore,
    (state) => state.panels.length >= MAX_PANELS,
  )
  if (full || !lastId) return null

  return (
    <Button
      variant="ghost"
      onClick={() => addPanel(lastId)}
      className="h-full w-11 shrink-0 snap-end flex-col gap-2 border-l border-dashed border-border text-muted-foreground"
    >
      <span className="flex size-7 items-center justify-center border border-border bg-background text-foreground">
        <IconPlus />
      </span>
      <span className="[writing-mode:vertical-rl]">{m.add_panel()}</span>
    </Button>
  )
}
