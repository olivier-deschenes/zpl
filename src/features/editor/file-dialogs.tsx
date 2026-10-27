import { useId, useRef } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '#/components/ui/input-group'
import { Label } from '#/components/ui/label'
import { toFileBaseName } from '#/lib/zpl/export'
import { m } from '#/paraglide/messages'
import { deleteFile, setFileName } from './store'
import type { EditorFile } from './store'

interface FileDialogProps {
  file: EditorFile
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocusRef: React.RefObject<HTMLElement | null>
}

export function DeleteFileDialog({
  file,
  open,
  onOpenChange,
  returnFocusRef,
}: FileDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocusRef.current?.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">
            {file.disk
              ? m.remove_file_title({ name: `${file.fileName}.zpl` })
              : m.delete_file_title({ name: `${file.fileName}.zpl` })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {file.disk ? m.remove_disk_file_hint() : m.delete_file_hint()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.keep_file()}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => deleteFile(file.id)}
          >
            {file.disk ? m.remove_file() : m.delete_file()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function RenameFileDialog({
  file,
  open,
  onOpenChange,
  returnFocusRef,
}: FileDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const nameSchema = z
    .string()
    .refine(
      (value) => toFileBaseName(value, 'zpl') !== '',
      m.invalid_file_name(),
    )
  const form = useForm({
    defaultValues: { name: file.fileName },
    onSubmit: ({ value }) => {
      if (!open) return
      setFileName(file.id, value.name)
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
          inputRef.current?.select()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocusRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{m.rename_file()}</DialogTitle>
          <DialogDescription>{m.rename_file_hint()}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <form.Field name="name" validators={{ onChange: nameSchema }}>
            {(field) => {
              const error = field.state.meta.errors.at(0)?.message
              return (
                <div className="flex flex-col gap-2">
                  <Label htmlFor={id}>{m.file_name()}</Label>
                  <InputGroup>
                    <InputGroupInput
                      ref={inputRef}
                      id={id}
                      name="name"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      data-1p-ignore
                      data-lpignore="true"
                      spellCheck={false}
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${id}-error` : undefined}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>.zpl</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  {error && (
                    <p
                      role="alert"
                      id={`${id}-error`}
                      className="text-xs text-destructive"
                    >
                      {error}
                    </p>
                  )}
                </div>
              )
            }}
          </form.Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {m.cancel()}
              </Button>
            </DialogClose>
            <Button type="submit">{m.rename()}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
