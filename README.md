# ZPL editor

A browser-based editor for Zebra ZPL labels, live at [zpl.puuid.com](https://zpl.puuid.com):

- Live preview rendered by [Labelary](https://labelary.com/viewer.html)'s public API 600 ms after you stop typing, so the ZPL is sent to labelary.com. Requests are spaced to stay under its rate limit of 3 a second; jobs show their first 50 labels.
- Up to four panels side by side (swipe between them on phones), each with its own label size and print density. Panels are saved in the browser.
- Compare a panel with another panel, side by side or as a colour-coded difference overlay, to see what changed between two versions.
- Hover a command to see what it and its values mean; problems Labelary's linter finds are underlined in the code.
- Pasted or dropped base64 is detected and decoded automatically.
- Export to PNG (a zip for multi-label jobs) or PDF at the real label size, or copy as ZPL or base64.
- Copy a share link from a panel's Export menu. The label is compressed into the part of the URL after `#`, which browsers never send to a server; opening the link adds the label as the first panel.
- Open a label from base64 ZPL in the URL: `https://zpl.puuid.com/#base64=<base64>` (or `?base64=<base64>`). Optional `dpmm`, `w` and `h` (inches) set the print density and label size.
- Label size and print density fall back to the settings when the ZPL has no `^PW` / `^LL`.

## Development

```bash
bun install
bun run dev
```

The dev server runs on http://localhost:3000. Run Vite under Node (`bun run`, not `bun --bun run`): the Cloudflare plugin's Miniflare dev server crashes on the Bun runtime.

| Command          | What it does                    |
| ---------------- | ------------------------------- |
| `bun run test`   | Unit tests (Vitest)             |
| `bun run lint`   | ESLint with the TanStack config |
| `bun run format` | Prettier, then ESLint fixes     |
| `bun run check`  | Prettier check only             |
| `bun run build`  | Production build into `dist/`   |

## Deploying

The app runs on Cloudflare Workers through the Cloudflare Vite plugin. `bun run deploy` builds and runs `wrangler deploy`; the custom domains are listed in `wrangler.jsonc`. Run `bunx wrangler login` once before the first deploy.

## Project layout

- `src/routes/index.tsx`: the page and its row of panels. The route is client-only (`ssr: false`), since CodeMirror and the canvas previews need the browser.
- `src/features/editor/`: the editor, preview, toolbar and the TanStack Store that holds the panels.
- `src/lib/zpl/`: label settings, the Labelary client, export, base64 detection and image diffing, with their unit tests. [zplr](https://github.com/le2ni/zplr) is only used to parse ZPL for the editor's hints.
- `messages/en.json`: UI strings, compiled by Paraglide into `src/paraglide/` (generated, not committed).
- `src/components/ui/`: shadcn/ui components. Add more with `bunx shadcn@latest add <component>`.

Built with TanStack Start, Router, Query, Store, Form and Pacer, shadcn/ui on Tailwind CSS, and CodeMirror 6.

## Branding and link previews

- `public/logo.svg`: the label-shaped Z mark in the existing editor toolbar. The toolbar inverts it in dark mode; `public/favicon.svg` adapts to the browser's theme.
- `assets/brand/og-image.svg`: editable vector source for the 1200 × 630 share card, with Geist lettering outlined so it renders without installed fonts. `public/og-image.png` is the social preview used by Open Graph and Twitter cards.
- `public/favicon.ico`, `public/apple-touch-icon.png`, and `public/icon-*.png`: browser and saved-site icons derived from the same mark. `public/site.webmanifest` declares the saved-site identity.
- `src/lib/site.ts`: the canonical URL. Both custom domains identify `https://zpl.puuid.com/` as the canonical site; keep `public/robots.txt` and `public/sitemap.xml` in sync if it changes.
- `src/routes/__root.tsx`: server-rendered page metadata. Link previews use the same generic card for every shared label; the label's URL fragment is never included in page metadata.
- `messages/en.json`: the page title, description, and share-image description.

Deploy the app and its public assets together for the new link previews to become available. Sharing services may cache earlier previews until they fetch the page again.
