import { useSelector } from '@tanstack/react-store'
import {
  IconDeviceFloppy,
  IconFolderOpen,
  IconPlugConnectedX,
} from '@tabler/icons-react'

import { Button } from '#/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { cn } from '#/lib/utils'
import { m } from '#/paraglide/messages'
import {
  canOpenFromDisk,
  diskStatusStore,
  openFromDisk,
  reconnectDiskFile,
} from './disk-files'
import type { DiskStatus } from './disk-files'
import { editorStore, selectFile } from './store'

function useDiskFile(id: string) {
  const name = useSelector(editorStore, (state) => {
    const file = selectFile(state, id)
    return file?.disk ? `${file.fileName}.zpl` : null
  })
  const status = useSelector(
    diskStatusStore,
    (state): DiskStatus => state[id] ?? 'connecting',
  )
  return name === null ? null : { name, status }
}

function statusText(name: string, status: DiskStatus) {
  switch (status) {
    case 'synced':
    case 'connecting':
      return m.disk_synced({ name })
    case 'permission':
      return m.disk_permission({ name })
    case 'missing':
      return m.disk_missing({ name })
    case 'error':
      return m.disk_error({ name })
  }
}

/** Marks a file that lives on disk rather than in the browser. */
export function DiskIcon({
  id,
  className,
}: {
  id: string
  className?: string
}) {
  const disk = useDiskFile(id)
  if (!disk) return null
  const linked = disk.status === 'synced' || disk.status === 'connecting'
  const Icon = linked ? IconDeviceFloppy : IconPlugConnectedX
  return (
    <Icon
      role="img"
      aria-label={statusText(disk.name, disk.status)}
      className={cn(
        'size-3.5 shrink-0',
        linked ? 'text-muted-foreground' : 'text-destructive',
        className,
      )}
    />
  )
}

/** The panel header's disk indicator, which also restores a lost link. */
export function DiskStatusButton({ id }: { id: string }) {
  const disk = useDiskFile(id)
  if (!disk) return null
  const text = statusText(disk.name, disk.status)
  const linked = disk.status === 'synced' || disk.status === 'connecting'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {linked ? (
          <span
            tabIndex={0}
            className="flex size-6 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <IconDeviceFloppy
              role="img"
              aria-label={text}
              className="size-3.5 text-muted-foreground"
            />
          </span>
        ) : (
          <Button
            variant="outline"
            size="xs"
            className="shrink-0 text-destructive"
            onClick={() =>
              void (disk.status === 'missing'
                ? openFromDisk(id)
                : reconnectDiskFile(id))
            }
          >
            <IconPlugConnectedX />
            {disk.status === 'missing' ? m.disk_find() : m.disk_reconnect()}
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  )
}

export function OpenFromDiskButton({
  onOpened,
  ...props
}: React.ComponentProps<typeof Button> & { onOpened?: () => void }) {
  const supported = canOpenFromDisk()
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" tabIndex={supported ? undefined : 0}>
          <Button
            disabled={!supported}
            onClick={() => {
              onOpened?.()
              void openFromDisk()
            }}
            {...props}
          >
            <IconFolderOpen />
            {m.open_from_disk()}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">
        {supported ? m.open_from_disk_hint() : m.open_from_disk_unsupported()}
      </TooltipContent>
    </Tooltip>
  )
}
