import { useState } from 'react'
import { useDebouncedValue } from '@tanstack/react-pacer'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useSelector } from '@tanstack/react-store'

import { DEFAULT_SETTINGS, renderLabels } from '#/lib/zpl/render'
import type { RenderJobResult } from '#/lib/zpl/render'
import { editorStore, selectPanel } from './store'

const RENDER_DELAY_MS = 300

export interface LabelRender {
  /** The exact source this result was rendered from. */
  source: string
  result: RenderJobResult<HTMLCanvasElement>
}

export function useLabelRender(panelId: string) {
  const source = useSelector(
    editorStore,
    (state) => selectPanel(state, panelId)?.source ?? '',
  )
  const settings = useSelector(
    editorStore,
    (state) => selectPanel(state, panelId)?.settings ?? DEFAULT_SETTINGS,
  )
  const [debouncedSource] = useDebouncedValue(source, {
    wait: RENDER_DELAY_MS,
  })

  const query = useQuery({
    queryKey: ['zpl-render', debouncedSource, settings],
    queryFn: async (): Promise<LabelRender> => ({
      source: debouncedSource,
      result: await renderLabels(debouncedSource, settings),
    }),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    gcTime: 30_000,
    retry: false,
  })

  // Keep showing the last good render if a newer one fails outright.
  const [lastGood, setLastGood] = useState(query.data)
  if (query.data && query.data !== lastGood) setLastGood(query.data)

  return {
    render: query.data ?? lastGood,
    isRendering: query.isFetching || source !== debouncedSource,
    error: query.error,
  }
}
