import { useId } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'

import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import {
  DEFAULT_SETTINGS,
  DENSITIES,
  MAX_SIZE_IN,
  MIN_SIZE_IN,
} from '#/lib/zpl/settings'
import type { PrintDensity } from '#/lib/zpl/settings'
import { m } from '#/paraglide/messages'
import { editorStore, selectPanel, setSettings } from './store'

/** Opens the panel's label settings from `children`, the trigger button. */
export function SettingsPopover({
  panelId,
  children,
}: {
  panelId: string
  children: React.ReactNode
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{children}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{m.settings()}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>{m.settings()}</PopoverTitle>
          <PopoverDescription>{m.settings_hint()}</PopoverDescription>
        </PopoverHeader>
        <SettingsForm panelId={panelId} />
      </PopoverContent>
    </Popover>
  )
}

const sizeSchema = z
  .string()
  .trim()
  .transform(Number)
  .pipe(
    z
      .number({ error: m.invalid_size() })
      .min(MIN_SIZE_IN, m.invalid_size())
      .max(MAX_SIZE_IN, m.invalid_size()),
  )

const settingsSchema = z.object({
  dpmm: z
    .enum(DENSITIES.map(({ dpmm }) => String(dpmm)))
    .transform((value) => Number(value) as PrintDensity),
  widthIn: sizeSchema,
  heightIn: sizeSchema,
})

/** Applies every valid change straight away; invalid input stays visible until fixed. */
function SettingsForm({ panelId }: { panelId: string }) {
  const id = useId()
  const settings =
    selectPanel(editorStore.state, panelId)?.settings ?? DEFAULT_SETTINGS

  const form = useForm({
    defaultValues: {
      dpmm: String(settings.dpmm),
      widthIn: String(settings.widthIn),
      heightIn: String(settings.heightIn),
    },
    listeners: {
      onChange: ({ formApi }) => {
        const parsed = settingsSchema.safeParse(formApi.state.values)
        if (parsed.success) setSettings(panelId, parsed.data)
      },
    },
  })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => event.preventDefault()}
    >
      <form.Field name="dpmm">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-dpmm`}>{m.density()}</Label>
            <Select
              value={field.state.value}
              onValueChange={field.handleChange}
            >
              <SelectTrigger id={`${id}-dpmm`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DENSITIES.map(({ dpmm, dpi }) => (
                  <SelectItem key={dpmm} value={String(dpmm)}>
                    {dpi} dpi ({dpmm} dpmm)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <div className="grid grid-cols-2 gap-3">
        {(['widthIn', 'heightIn'] as const).map((name) => (
          <form.Field
            key={name}
            name={name}
            validators={{ onChange: sizeSchema }}
          >
            {(field) => {
              const error = field.state.meta.errors.at(0)?.message
              const inputId = `${id}-${name}`
              return (
                <div className="flex min-w-0 flex-col gap-2">
                  <Label htmlFor={inputId}>
                    {name === 'widthIn' ? m.width_in() : m.height_in()}
                  </Label>
                  <Input
                    id={inputId}
                    type="number"
                    inputMode="decimal"
                    step="0.25"
                    min={MIN_SIZE_IN}
                    max={MAX_SIZE_IN}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${inputId}-error` : undefined}
                    className="tabular-nums"
                  />
                  {error && (
                    <p
                      id={`${inputId}-error`}
                      className="text-xs text-destructive"
                    >
                      {error}
                    </p>
                  )}
                </div>
              )
            }}
          </form.Field>
        ))}
      </div>
    </form>
  )
}
