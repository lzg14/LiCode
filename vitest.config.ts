import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      'bun:sqlite': resolve(__dirname, 'packages/__mocks__/bun-sqlite.ts'),
    },
  },
})
