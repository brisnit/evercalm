import { describe, expect, it } from 'vitest'
import { isFrameworkDevInstrumentationError } from '../e2e/console-noise'

/**
 * T3 regression. The browser suite fails on any console error; the only
 * exception is React's development-only Server Components timing measure.
 * These cases fail if the exception is removed (the T3 message would fail the
 * suite again) or widened (real errors would slip through).
 */
const T3 =
  "Failed to execute 'measure' on 'Performance': '​AppLayout' cannot have a negative time stamp."

describe('framework development instrumentation', () => {
  it('recognizes the React Server Components negative-time measure, for any component', () => {
    expect(isFrameworkDevInstrumentationError({ text: T3, source: '' })).toBe(true)
    expect(
      isFrameworkDevInstrumentationError({
        text: T3.replace('AppLayout', 'MyWorkPage'),
        source: 'http://localhost:3000/_next/static/chunks/react-server-dom.js:1',
      }),
    ).toBe(true)
  })

  it('does not excuse the same failure from a measure without the Server Components marker', () => {
    expect(
      isFrameworkDevInstrumentationError({
        text: "Failed to execute 'measure' on 'Performance': 'lesson-player' cannot have a negative time stamp.",
        source: '',
      }),
    ).toBe(false)
  })

  it('does not excuse anything else', () => {
    for (const text of [
      'Type error',
      'Hydration failed because the server rendered HTML did not match the client.',
      "TypeError: Cannot read properties of undefined (reading 'id')",
      `${T3} And something else went wrong.`,
      "Failed to execute 'measure' on 'Performance': The mark 'x' does not exist.",
    ]) {
      expect(isFrameworkDevInstrumentationError({ text, source: '' }), text).toBe(false)
    }
  })
})
