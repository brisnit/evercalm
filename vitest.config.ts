import { defineConfig } from 'vitest/config'
import path from 'node:path'

const alias = { '@': path.resolve(import.meta.dirname, './src') }

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['./tests/global-setup.ts'],
          // Runs inside the worker, so modules that read the environment at
          // call time have valid throwaway values.
          setupFiles: ['./tests/setup-env.ts'],
          // One real database, shared serially: tests assert on role
          // attributes and session-local settings, which parallel workers
          // would make ambiguous.
          pool: 'forks',
          maxWorkers: 1,
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
})
