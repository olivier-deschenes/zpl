import type { ZplDiagnostic } from '#/lib/zpl/render'

/** zplr can report a label's diagnostic at both job and label level. */
export function uniqueDiagnostics(
  diagnostics: readonly ZplDiagnostic[],
): ZplDiagnostic[] {
  const seen = new Set<string>()
  return diagnostics.filter((diagnostic) => {
    const key = [
      diagnostic.code,
      diagnostic.span?.start,
      diagnostic.span?.end,
      diagnostic.labelIndex,
    ].join(':')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Offsets of the first character of every line, for offset → line lookups. */
export function lineStarts(source: string): number[] {
  const starts = [0]
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10) starts.push(index + 1)
  }
  return starts
}

/** One-based line number containing `offset`. */
export function lineAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (starts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return low + 1
}
