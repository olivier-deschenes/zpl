import { useId, useRef } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
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
import type { ExportFormat } from '#/lib/zpl/export'
import { m } from '#/paraglide/messages'

interface DownloadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  format: ExportFormat
  /** Selected when the dialog opens, so Enter alone downloads it. */
  defaultName: string
  /** Labels in the current preview; several PNGs download as a zip. */
  labelCount: number
  onDownload: (baseName: string) => void
  /** Where focus goes once the dialog closes. */
  returnFocusRef: React.RefObject<HTMLElement | null>
}

export function DownloadDialog({
  open,
  onOpenChange,
  format,
  defaultName,
  labelCount,
  onDownload,
  returnFocusRef,
}: DownloadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const zipped = format === 'png' && labelCount > 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          // Select the whole name so typing replaces it.
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
          <DialogTitle>
            {m.download_title({ format: format.toUpperCase() })}
          </DialogTitle>
          <DialogDescription>
            {zipped
              ? m.download_zip_hint({ count: labelCount })
              : m.download_hint()}
          </DialogDescription>
        </DialogHeader>
        <DownloadForm
          inputRef={inputRef}
          format={format}
          extension={zipped ? 'zip' : format}
          defaultName={defaultName}
          onSubmit={(baseName) => {
            // Focus stays in the form until the exit animation ends, so a
            // quick second Enter would otherwise download it again.
            if (!open) return
            onOpenChange(false)
            onDownload(baseName)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function DownloadForm({
  inputRef,
  format,
  extension,
  defaultName,
  onSubmit,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  format: ExportFormat
  extension: string
  defaultName: string
  onSubmit: (baseName: string) => void
}) {
  const id = useId()
  const nameSchema = z
    .string()
    .refine(
      (value) => toFileBaseName(value, format) !== '',
      m.invalid_file_name(),
    )

  const form = useForm({
    defaultValues: { name: defaultName },
    onSubmit: ({ value }) => onSubmit(toFileBaseName(value.name, format)),
  })

  return (
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
          const inputId = `${id}-name`
          return (
            <div className="flex flex-col gap-2">
              <Label htmlFor={inputId}>{m.file_name()}</Label>
              <InputGroup>
                <InputGroupInput
                  ref={inputRef}
                  id={inputId}
                  name="name"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  data-1p-ignore
                  data-lpignore="true"
                  spellCheck={false}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${inputId}-error` : undefined}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>.{extension}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              {error && (
                <p id={`${inputId}-error`} className="text-xs text-destructive">
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
        <Button type="submit">{m.download()}</Button>
      </DialogFooter>
    </form>
  )
}
