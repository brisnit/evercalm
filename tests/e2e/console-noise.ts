/**
 * Console messages that come from the FRAMEWORK'S development instrumentation,
 * not from EverCalm - and only those.
 *
 * T3 (docs/ux-design-backlog.md). In development, React's Server Components
 * client draws each server component on the browser's Performance panel with
 * `performance.measure`. It clamps a negative start time to zero but not a
 * negative end time, so when a server component's recorded timing lands
 * before the page's time origin the browser throws
 *
 *   Failed to execute 'measure' on 'Performance': '​AppLayout' cannot have a
 *   negative time stamp.
 *
 * The name carries React's zero-width-space prefix (U+200B), which marks a
 * Server Components track entry; application code never produces it. The
 * production client has no such measure calls at all. It was seen twice in
 * full browser runs, naming AppLayout, and never reproduced in isolation.
 *
 * The match is deliberately exact: the message shape AND the U+200B marker.
 * Anything else - including a real `performance.measure` failure from our own
 * code - is still an error. tests/unit/console-noise.test.ts pins this.
 */
const SERVER_COMPONENT_MEASURE =
  /^Failed to execute 'measure' on 'Performance': '​[^']+' cannot have a negative time stamp\.$/

export function isFrameworkDevInstrumentationError(entry: {
  text: string
  source: string
}): boolean {
  return SERVER_COMPONENT_MEASURE.test(entry.text.trim())
}
