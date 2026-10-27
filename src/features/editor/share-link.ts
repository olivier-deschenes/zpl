import { useRouter } from '@tanstack/react-router'

import { writeClipboard } from '#/lib/zpl/export'
import {
  ShareLinkError,
  decodeShareHash,
  encodeShareHash,
} from '#/lib/zpl/share'
import { editorStore, openSharedLabel, selectFile } from './store'

/**
 * Opens the label carried by a share link's fragment. Returns whether the
 * fragment was a share link, even a broken one, so the caller knows to
 * clear it.
 */
export function openShareLink(hash: string): boolean {
  let shared
  try {
    shared = decodeShareHash(hash)
  } catch (error) {
    if (!(error instanceof ShareLinkError)) throw error
    return true
  }
  if (!shared) return false

  openSharedLabel(shared.source, shared.settings)
  return true
}

/** Copies a link that opens the panel's label, as it is now, in this app. */
export function useCopyShareLink(panelId: string) {
  const router = useRouter()

  return async () => {
    const panel = selectFile(editorStore.state, panelId)
    if (!panel?.source.trim()) return

    const { href } = router.buildLocation({
      to: '/',
      hash: encodeShareHash(panel.source, panel.settings),
    })
    await writeClipboard(new URL(href, window.location.origin).href)
  }
}
