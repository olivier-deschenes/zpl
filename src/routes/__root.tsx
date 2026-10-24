import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import { TooltipProvider } from '#/components/ui/tooltip'
import { SITE_URL, SOCIAL_IMAGE_URL } from '#/lib/site'
import { m } from '#/paraglide/messages'

import { getLocale } from '#/paraglide/runtime'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: m.app_meta_title(),
      },
      {
        name: 'description',
        content: m.app_description(),
      },
      { name: 'application-name', content: m.app_title() },
      { name: 'theme-color', content: '#171717' },
      { name: 'color-scheme', content: 'light dark' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: m.app_title() },
      { property: 'og:title', content: m.app_meta_title() },
      { property: 'og:description', content: m.app_description() },
      { property: 'og:url', content: SITE_URL },
      { property: 'og:image', content: SOCIAL_IMAGE_URL },
      { property: 'og:image:type', content: 'image/png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: m.social_image_alt() },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: m.app_meta_title() },
      { name: 'twitter:description', content: m.app_description() },
      { name: 'twitter:image', content: SOCIAL_IMAGE_URL },
      { name: 'twitter:image:alt', content: m.social_image_alt() },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      { rel: 'canonical', href: SITE_URL },
      { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      {
        rel: 'apple-touch-icon',
        href: '/apple-touch-icon.png',
        sizes: '180x180',
      },
      { rel: 'manifest', href: '/site.webmanifest' },
    ],
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          name: m.app_title(),
          url: SITE_URL,
          description: m.app_description(),
          applicationCategory: 'DeveloperApplication',
          operatingSystem: 'Any',
          image: SOCIAL_IMAGE_URL,
        }),
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang={getLocale()}>
      <head>
        <HeadContent />
      </head>
      <body>
        <a
          href="#editor"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
        >
          {m.skip_to_editor()}
        </a>
        <TooltipProvider delayDuration={600}>{children}</TooltipProvider>
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
