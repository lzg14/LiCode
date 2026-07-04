import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'bun:sqlite': resolve(__dirname, 'packages/__mocks__/bun-sqlite.ts'),
    },
  },
})
