import { useState } from 'react'
import { useDebouncedValue } from '@tanstack/react-pacer'
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import { useSelector } from '@tanstack/react-store'

import { LabelaryError, renderWithLabelary } from '#/lib/zpl/labelary'
import type { LabelaryResult } from '#/lib/zpl/labelary'
import { DEFAULT_SETTINGS, readZplSize } from '#/lib/zpl/settings'
import type { LabelSettings, ZplSize } from '#/lib/zpl/settings'
import { editorStore, selectFile } from './store'

/** Long enough after typing stops to stay under Labelary's rate limit. */
const RENDER_DELAY_MS = 600

export interface LabelRender extends LabelaryResult {
  /** The exact source this result was rendered from. */
  source: string
  /** What the source's ^PW / ^LL ask for, which the settings override. */
  zplSize: ZplSize
}

/**
 * Panels showing the same label at the same settings share one render, and
 * exports reuse the one the preview already fetched.
 */
export function labelRenderQuery(source: string, settings: LabelSettings) {
  return queryOptions({
    queryKey: ['label-render', source, settings],
    queryFn: async ({ signal }): Promise<LabelRender> => {
      const [result, zplSize] = await Promise.all([
        renderWithLabelary(source, settings, signal),
        readZplSize(source, settings.dpmm),
      ])
      return { ...result, source, zplSize }
    },
    staleTime: Infinity,
    gcTime: 30_000,
    retry: (failures, error) =>
      failures < 2 && error instanceof LabelaryError && error.status === 429,
    retryDelay: (_failures, error) =>
      error instanceof LabelaryError && error.retryAfter
        ? error.retryAfter * 1000
        : 1000,
  })
}

export function useLabelRender(panelId: string) {
  const source = useSelector(
    editorStore,
    (state) => selectFile(state, panelId)?.source ?? '',
  )
  const settings = useSelector(
    editorStore,
    (state) => selectFile(state, panelId)?.settings ?? DEFAULT_SETTINGS,
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
    retry: () => void query.refetch(),
  }
}

/**
 * What another panel's preview shows, read from the cache that preview
 * fills rather than fetched again.
 */
export function useOtherPanelRender(panelId: string | undefined) {
  const source = useSelector(editorStore, (state) =>
    panelId === undefined ? '' : (selectFile(state, panelId)?.source ?? ''),
  )
  const settings = useSelector(editorStore, (state) =>
    panelId === undefined
      ? DEFAULT_SETTINGS
      : (selectFile(state, panelId)?.settings ?? DEFAULT_SETTINGS),
  )

  const query = useQuery({
    ...labelRenderQuery(source, settings),
    // That panel's own preview fetches it once its typing pause is over.
    enabled: false,
    placeholderData: keepPreviousData,
  })

  return {
    render: panelId === undefined ? undefined : query.data,
    /** Older than the panel's source until its preview catches up. */
    isStale: query.isPlaceholderData || query.isFetching,
  }
}
