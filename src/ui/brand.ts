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

/**
 * The wordmark, TRIMMED TO ITS INK.
 *
 * The supplied artwork (Brand Assets/ECL.png, 695x346) carries about a third
 * of its canvas as transparent margin - 66px at the left, 111px below. Sized
 * by height, that margin ate the logo: a nominal 26px header logo rendered
 * roughly 14px of actual letterform, which is why the mark read as far too
 * small everywhere it appeared.
 *
 * The published asset is cropped to the alpha bounding box, so `height` now
 * means the height of the visible mark and layouts get the size they ask for.
 */
export const WORDMARK: BrandAsset = {
  src: '/brand/evercalm-wordmark.png',
  intrinsicWidth: 568,
  intrinsicHeight: 193,
  aspectRatio: 568 / 193,
  format: 'png',
}

/**
 * The wordmark is dark type on transparency, so on dark grounds it must sit
 * on a light chip rather than be colour-inverted - inverting would turn the
 * brand gradient green.
 */
export const WORDMARK_NEEDS_LIGHT_BACKGROUND = true
