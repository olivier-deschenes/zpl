import type { ExportFormat } from './export'

export const DEFAULT_FILE_NAME = 'label'

// Characters Windows, macOS or Linux refuse in a file name.
// eslint-disable-next-line no-control-regex -- control characters are the point
const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g

/**
 * Turns what someone typed into a safe base name: drops the extension they
 * may have added out of habit and replaces characters file systems reject.
 * Returns an empty string when nothing usable is left.
 */
export function toFileBaseName(input: string, format: ExportFormat): string {
  const safe = trimFileName(input.replace(UNSAFE_FILE_NAME_CHARS, '-'))
  return trimFileName(safe.replace(new RegExp(`\\.${format}$`, 'i'), ''))
}

/** Leading dots hide a file; trailing dots and spaces trip up Windows. */
function trimFileName(name: string) {
  return name.replace(/^[\s.]+|[\s.]+$/g, '')
}
