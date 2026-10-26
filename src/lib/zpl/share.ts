import { Inflate, deflateSync, strFromU8, strToU8 } from 'fflate'

import type { LabelSettings } from './settings'

/** The fragment parameter that holds the compressed ZPL. */
const SOURCE_PARAM = 'zpl'
/** Inflating stops here, so a crafted link can't exhaust memory. */
const MAX_SOURCE_BYTES = 8 * 1024 * 1024

/** A label read from a share link. */
export interface SharedLabel {
  source: string
  /** As written in the link, so possibly missing (NaN) or out of range. */
  settings: Record<keyof LabelSettings, number>
}

export class ShareLinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareLinkError'
  }
}

/**
 * The URL fragment, without `#`, that carries a label in a share link. The
 * ZPL is deflated and base64url-encoded. Browsers never send the fragment
 * to the server, so the label only goes where the link goes.
 */
export function encodeShareHash(
  source: string,
  settings: LabelSettings,
): string {
  return new URLSearchParams({
    [SOURCE_PARAM]: toBase64Url(deflateSync(strToU8(source), { level: 9 })),
    dpmm: String(settings.dpmm),
    w: String(settings.widthIn),
    h: String(settings.heightIn),
  }).toString()
}

/**
 * Reads the label from a URL fragment, with or without its `#`. Returns null
 * when the fragment isn't a share link, and throws a `ShareLinkError` when
 * it is one that was cut short or mangled on the way.
 */
export function decodeShareHash(hash: string): SharedLabel | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const data = params.get(SOURCE_PARAM)
  if (data === null) return null

  let source: string
  try {
    source = strFromU8(inflateCapped(fromBase64Url(data)))
  } catch (error) {
    throw new ShareLinkError(
      error instanceof Error ? error.message : String(error),
    )
  }

  return {
    source,
    settings: {
      dpmm: Number(params.get('dpmm')),
      widthIn: Number(params.get('w')),
      heightIn: Number(params.get('h')),
    },
  }
}

function inflateCapped(data: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let size = 0
  const inflate = new Inflate((chunk) => {
    size += chunk.length
    if (size > MAX_SOURCE_BYTES) throw new Error('The label is too large')
    chunks.push(chunk)
  })
  // Throws "unexpected EOF" when the data was cut short.
  inflate.push(data, true)

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  // atob accepts base64 without its padding.
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}
