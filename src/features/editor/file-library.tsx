import { useRef, useState } from 'react'
import { useSelector } from '@tanstack/react-store'
import {
  IconAlertTriangle,
  IconCheck,
  IconFileCode,
  IconFolder,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { m } from '#/paraglide/messages'
import { DeleteFileDialog, RenameFileDialog } from './file-dialogs'
import {
  MAX_PANELS,
  addFile,
  closeFile,
  editorStore,
  openFile,
  storageStatusStore,
} from './store'
import type { EditorFile } from './store'

interface FileLibraryProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FileLibrary({ open, onOpenChange }: FileLibraryProps) {
  const files = useSelector(editorStore, (state) => state.files)
  const openIds = useSelector(editorStore, (state) => state.openFileIds)
  const storageStatus = useSelector(storageStatusStore, (state) => state)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<{
    id: number
    type: 'rename' | 'delete'
    file: EditorFile
    open: boolean
  } | null>(null)
  const full = openIds.length >= MAX_PANELS
  const matches = files.filter((file) =>
    `${file.fileName}.zpl`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  )
  const opened = matches.filter((file) => openIds.includes(file.id))
  const closed = matches.filter((file) => !openIds.includes(file.id))
  const showDialog = (type: 'rename' | 'delete', file: EditorFile) => {
    setDialog((current) => ({
      id: (current?.id ?? 0) + 1,
      type,
      file,
      open: true,
    }))
    onOpenChange(false)
  }

  const fileRow = (file: EditorFile) => {
    const isOpen = openIds.includes(file.id)
    const name = `${file.fileName}.zpl`
    return (
      <li key={file.id} className="flex min-w-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 flex-1 justify-start gap-2 px-2 font-normal"
              aria-label={m.open_file_named({ name })}
              disabled={!isOpen && full}
              onClick={() => {
                if (openFile(file.id)) onOpenChange(false)
              }}
            >
              <IconFileCode className="shrink-0 text-muted-foreground" />
              <span className="truncate">{name}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{name}</TooltipContent>
        </Tooltip>
        {isOpen && (
          <FileAction
            label={m.close_file_tab({ name })}
            onClick={() => {
              closeFile(file.id)
              searchRef.current?.focus()
            }}
          >
            <IconX />
          </FileAction>
        )}
        <FileAction
          label={m.rename_file_named({ name })}
          onClick={() => showDialog('rename', file)}
        >
          <IconPencil />
        </FileAction>
        <FileAction
          label={m.delete_file_named({ name })}
          onClick={() => showDialog('delete', file)}
        >
          <IconTrash />
        </FileAction>
      </li>
    )
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(value) => {
          setSearch('')
          onOpenChange(value)
        }}
      >
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="sm"
            className="shrink-0 px-1.5"
            aria-label={
              storageStatus === 'saved'
                ? m.files_count({ count: files.length })
                : m.files_not_saved()
            }
          >
            {storageStatus === 'saved' ? (
              <IconFolder />
            ) : (
              <IconAlertTriangle className="text-destructive" />
            )}
            <span className="text-muted-foreground tabular-nums">
              {files.length}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-80 max-w-[calc(100vw-1rem)] gap-3 p-3"
          onCloseAutoFocus={(event) => {
            if (dialog?.open) event.preventDefault()
          }}
        >
          <div className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              aria-label={m.find_file()}
              placeholder={m.find_file()}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              data-1p-ignore
              data-lpignore="true"
              spellCheck={false}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-8 pl-7"
            />
          </div>
          {full && (
            <p className="text-xs text-muted-foreground">
              {m.open_file_limit({ count: MAX_PANELS })}
            </p>
          )}
          <div className="max-h-80 overflow-y-auto overscroll-contain">
            {opened.length > 0 && (
              <section aria-label={m.open_tabs()}>
                <h2 className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {m.open_tabs()}{' '}
                  <span className="tabular-nums">{opened.length}</span>
                </h2>
                <ul>{opened.map(fileRow)}</ul>
              </section>
            )}
            {closed.length > 0 && (
              <section
                aria-label={m.closed_files()}
                className={opened.length ? 'mt-2 border-t pt-2' : undefined}
              >
                <h2 className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {m.closed_files()}{' '}
                  <span className="tabular-nums">{closed.length}</span>
                </h2>
                <ul>{closed.map(fileRow)}</ul>
              </section>
            )}
            {matches.length === 0 && (
              <p className="px-2 py-5 text-center text-xs text-muted-foreground">
                {files.length ? m.no_matching_files() : m.no_saved_files()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 border-t pt-3">
            <Button
              size="sm"
              variant="outline"
              disabled={full}
              onClick={() => {
                if (addFile()) onOpenChange(false)
              }}
            >
              <IconPlus />
              {m.new_file()}
            </Button>
            {storageStatus === 'saved' && (
              <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                <IconCheck className="size-3" />
                {m.saved_in_browser()}
              </span>
            )}
          </div>
          {storageStatus === 'unavailable' && (
            <p role="alert" className="text-xs text-destructive">
              {m.storage_unavailable()}
            </p>
          )}
        </PopoverContent>
      </Popover>
      {dialog?.type === 'delete' && (
        <DeleteFileDialog
          key={dialog.file.id}
          file={dialog.file}
          open={dialog.open}
          returnFocusRef={triggerRef}
          onOpenChange={(value) =>
            setDialog((current) => current && { ...current, open: value })
          }
        />
      )}
      {dialog?.type === 'rename' && (
        <RenameFileDialog
          key={dialog.id}
          file={dialog.file}
          open={dialog.open}
          returnFocusRef={triggerRef}
          onOpenChange={(value) =>
            setDialog((current) => current && { ...current, open: value })
          }
        />
      )}
    </>
  )
}

function FileAction({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground"
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
