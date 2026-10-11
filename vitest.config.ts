import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts: the Cloudflare and TanStack Start
// plugins expect a dev server and break the Vitest runner.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
