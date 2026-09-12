/**
 * BRAND ASSET REGISTRY.
 *
 * The single place that knows where brand artwork lives and what shape it is.
 * Replacing the temporary PNG with a production SVG is a change to THIS FILE
 * ONLY - every layout sizes the mark from `aspectRatio`, never from pixel
 * dimensions, so nothing reflows when the asset changes.
 */

export interface BrandAsset {
  readonly src: string
  /** Intrinsic width / height. Layouts derive height from this. */
  readonly aspectRatio: number
  readonly intrinsicWidth: number
  readonly intrinsicHeight: number
  readonly format: 'png' | 'svg'
}

export const WORDMARK: BrandAsset = {
  src: '/brand/evercalm-wordmark.png',
  intrinsicWidth: 695,
  intrinsicHeight: 346,
  aspectRatio: 695 / 346,
  format: 'png',
}

/**
 * The wordmark is dark type on transparency, so on dark grounds it must sit
 * on a light chip rather than be colour-inverted - inverting would turn the
 * brand gradient green.
 */
export const WORDMARK_NEEDS_LIGHT_BACKGROUND = true
