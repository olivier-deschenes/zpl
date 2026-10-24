import { useDebouncedValue } from '@tanstack/react-pacer'
import { keepPreviousData, skipToken, useQuery } from '@tanstack/react-query'

import { LabelaryError, renderWithLabelary } from '#/lib/zpl/labelary'
import type { LabelaryResult } from '#/lib/zpl/labelary'
import type { LabelRender } from './use-label-render'

/** On top of the local render's delay, to stay under Labelary's rate limit. */
const LABELARY_DELAY_MS = 700

export interface LabelaryRender extends LabelaryResult {
  /** The local render these labels were fetched for, to diff against. */
  local: LabelRender
}

export function useLabelaryRender(
  render: LabelRender | undefined,
  enabled: boolean,
) {
  const [debounced] = useDebouncedValue(render, { wait: LABELARY_DELAY_MS })
  const labels = debounced?.result.labels ?? []
  const sizes = labels.map(({ width, height, printDensity }) => ({
    width,
    height,
    printDensity,
  }))

  const query = useQuery({
    queryKey: ['labelary-render', debounced?.source, sizes],
    queryFn:
      enabled && debounced && sizes.length > 0
        ? async ({ signal }): Promise<LabelaryRender> => ({
            ...(await renderWithLabelary(debounced.source, sizes, signal)),
            local: debounced,
          })
        : skipToken,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: (failures, error) =>
      failures < 2 && error instanceof LabelaryError && error.status === 429,
    retryDelay: (_failures, error) =>
      error instanceof LabelaryError && error.retryAfter
        ? error.retryAfter * 1000
        : 1000,
  })

  return {
    labelary: query.data,
    isFetching: query.isFetching || (enabled && render !== debounced),
    /** The labels shown are for older source and are being replaced. */
    isStale: query.isPlaceholderData || render !== query.data?.local,
    error: query.error,
    refetch: () => void query.refetch(),
  }
}
