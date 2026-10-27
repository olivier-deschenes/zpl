import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { paraglideVitePlugin } from '@inlang/paraglide-js'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  environments: {
    client: {
      build: {
        // bwip-js draws barcodes with bwipp.mjs, one generated ~850 kB module.
        // A module can't be split across chunks, so the bwip-js chunk needs
        // more room than Vite's default 500 kB.
        chunkSizeWarningLimit: 1000,
        rolldownOptions: {
          output: {
            codeSplitting: {
              // Large dependencies get chunks of their own, so the app's code
              // stays small and a deploy doesn't re-download them. A group
              // also takes the dependencies no earlier group has claimed.
              groups: [
                {
                  name: 'react',
                  test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                },
                {
                  name: 'codemirror',
                  test: /[\\/]node_modules[\\/](@codemirror|@lezer|@marijn|@uiw|crelt|style-mod|w3c-keyname)[\\/]/,
                },
                {
                  name: 'pdf-lib',
                  test: /[\\/]node_modules[\\/](pdf-lib|@pdf-lib)[\\/]/,
                },
                {
                  name: 'pdfjs',
                  test: /[\\/]node_modules[\\/]pdfjs-dist[\\/]/,
                },
                { name: 'bwip-js', test: /[\\/]node_modules[\\/]bwip-js[\\/]/ },
                { name: 'qrcode', test: /[\\/]node_modules[\\/]qrcode[\\/]/ },
                {
                  name: 'opentype',
                  test: /[\\/]node_modules[\\/]opentype\.js[\\/]/,
                },
                {
                  name: 'zplr',
                  test: /[\\/]node_modules[\\/]zplr[\\/]/,
                  // zplr's fflate is also the share links' fflate, which the
                  // entry needs; taking it along would load zplr at startup.
                  includeDependenciesRecursively: false,
                },
              ],
            },
          },
        },
      },
    },
  },
  plugins: [
    devtools(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      strategy: ['baseLocale'],
    }),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
})

export default config
