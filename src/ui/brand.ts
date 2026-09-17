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
 *
 * COLOUR (round 1, September 2026): recoloured from the supplied artwork onto
 * the stakeholder palette, part by part - wordmark Navy #1E2D3D, hands Deep
 * Teal #2A5C5A, central light Coral #E8856C, rays Soft Sage #7FB5A0. Shapes
 * are untouched: `scripts/recolour-wordmark.py` separates the parts by
 * connected components and rewrites colour only, so every pixel keeps its
 * original alpha and the letterforms and proportions are the supplied ones.
 * The original black and violet/magenta file is still at
 * `/brand/evercalm-wordmark.png`, so this is one line to revert, and a
 * production SVG would replace the src and nothing else.
 */
export const WORDMARK: BrandAsset = {
  src: '/brand/evercalm-wordmark-brand.png',
  intrinsicWidth: 568,
  intrinsicHeight: 193,
  aspectRatio: 568 / 193,
  format: 'png',
}

/**
 * On a navy ground the navy wordmark is 1.18:1 and Deep Teal hands are 2.18:1,
 * so a dark variant changes ONLY those two colours - the wordmark to Warm Sand
 * (13.47:1) and the hands to the light teal used for dark surfaces (7.18:1).
 * The coral light and sage rays already pass there (6.29:1 and 7.09:1) and are
 * unchanged, so the mark reads as the same mark. Shapes are identical: it is
 * the same artwork through the same script.
 */
export const WORDMARK_ON_DARK: BrandAsset = {
  ...WORDMARK,
  src: '/brand/evercalm-wordmark-brand-on-dark.png',
}

/**
 * The mark no longer needs a light chip on dark grounds: WORDMARK_ON_DARK is
 * legible on navy by itself.
 */
export const WORDMARK_NEEDS_LIGHT_BACKGROUND = false
