import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { writeClipboard } from '#/lib/zpl/export'
import {
  ShareLinkError,
  decodeShareHash,
  encodeShareHash,
} from '#/lib/zpl/share'
import { m } from '#/paraglide/messages'
import {
  editorStore,
  insertPanel,
  openSharedLabel,
  removePanel,
  selectPanel,
} from './store'

/** Chat apps and mail clients may cut off links longer than this. */
const LONG_LINK_LENGTH = 16_000

/**
 * Opens the label carried by a share link's fragment and says what changed.
 * Returns whether the fragment was a share link, even a broken one, so the
 * caller knows to clear it.
 */
export function openShareLink(hash: string): boolean {
  let shared
  try {
    shared = decodeShareHash(hash)
  } catch (error) {
    if (!(error instanceof ShareLinkError)) throw error
    toast.error(m.share_link_damaged())
    return true
  }
  if (!shared) return false

  const opened = openSharedLabel(shared.source, shared.settings)
  if (opened.status === 'already-open') {
    toast(m.shared_label_already_open())
  } else if (opened.closed) {
    const { panel, index } = opened.closed
    toast(
      m.shared_label_closed_panel({
        name: m.panel_title({ index: index + 1 }),
      }),
      {
        duration: 8000,
        action: {
          label: m.undo(),
          onClick: () => {
            removePanel(opened.id)
            insertPanel(panel, index)
          },
        },
      },
    )
  } else if (!opened.replacedSample) {
    toast(m.shared_label_opened())
  }
  return true
}

/** Copies a link that opens the panel's label, as it is now, in this app. */
export function useCopyShareLink(panelId: string) {
  const router = useRouter()

  return async () => {
    const panel = selectPanel(editorStore.state, panelId)
    if (!panel?.source.trim()) {
      toast.error(m.share_empty())
      return
    }

    const { href } = router.buildLocation({
      to: '/',
      hash: encodeShareHash(panel.source, panel.settings),
    })
    const link = new URL(href, window.location.origin).href
    try {
      await writeClipboard(link)
    } catch {
      toast.error(m.copy_failed())
      return
    }
    if (link.length > LONG_LINK_LENGTH) {
      toast.warning(m.copied_long_share_link())
    } else {
      toast.success(m.copied_share_link())
    }
  }
}
