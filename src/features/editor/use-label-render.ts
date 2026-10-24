import { useState } from 'react'
import { useDebouncedValue } from '@tanstack/react-pacer'
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import { useSelector } from '@tanstack/react-store'

import { DEFAULT_SETTINGS, renderLabels } from '#/lib/zpl/render'
import type { LabelSettings, RenderJobResult } from '#/lib/zpl/render'
import { editorStore, selectPanel } from './store'

const RENDER_DELAY_MS = 300

export interface LabelRender {
  /** The exact source this result was rendered from. */
  source: string
  result: RenderJobResult<HTMLCanvasElement>
}

/** Panels showing the same label at the same settings share one render. */
function labelRenderQuery(source: string, settings: LabelSettings) {
  return queryOptions({
    queryKey: ['zpl-render', source, settings],
    queryFn: async (): Promise<LabelRender> => ({
      source,
      result: await renderLabels(source, settings),
    }),
    staleTime: Infinity,
    gcTime: 30_000,
    retry: false,
  })
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
    ...labelRenderQuery(debouncedSource, settings),
    placeholderData: keepPreviousData,
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

/**
 * What another panel's preview shows, read from the cache that preview
 * fills rather than rendered again.
 */
export function useOtherPanelRender(panelId: string | undefined) {
  const source = useSelector(editorStore, (state) =>
    panelId === undefined ? '' : (selectPanel(state, panelId)?.source ?? ''),
  )
  const settings = useSelector(editorStore, (state) =>
    panelId === undefined
      ? DEFAULT_SETTINGS
      : (selectPanel(state, panelId)?.settings ?? DEFAULT_SETTINGS),
  )

  const query = useQuery({
    ...labelRenderQuery(source, settings),
    // That panel's own preview renders it once its typing pause is over.
    enabled: false,
    placeholderData: keepPreviousData,
  })

  return {
    render: panelId === undefined ? undefined : query.data,
    /** Older than the panel's source until its preview catches up. */
    isStale: query.isPlaceholderData || query.isFetching,
  }
}
