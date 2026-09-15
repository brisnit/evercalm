/**
 * Lifestyle imagery for the homepage.
 *
 * Photographs supplied by the product owner in September 2026 (originals in
 * Brand Assets/, web copies in public/images/home/). `position` keeps faces in
 * frame where a placement crops the photo to a different shape. See
 * docs/ux-refinement/lifestyle-imagery.md.
 */
export interface LifestyleImage {
  id: string
  /** What the photograph shows, in words. */
  alt: string
  /** Width / height of the placement. */
  ratio: string
  src: string | null
  /** CSS object-position for the crop. */
  position?: string
  licence: string | null
}

const SUPPLIED = 'Supplied by the product owner for the EverCalm homepage, September 2026'

export const IMAGERY = {
  prepForService: {
    id: 'prep-for-service',
    alt: 'A chef and a cook at the kitchen pass reading the notes for tonight’s service before doors open.',
    ratio: '4 / 5',
    src: '/images/home/prep-for-service.webp',
    position: '50% 45%',
    licence: SUPPLIED,
  },
  managerCheckIn: {
    id: 'manager-check-in',
    alt: 'A bar manager holding a tablet checks in with a bartender at her station before the evening shift.',
    ratio: '3 / 2',
    src: '/images/home/manager-check-in.webp',
    licence: SUPPLIED,
  },
  stylistStation: {
    id: 'stylist-station',
    alt: 'A stylist prepares her chair and cape at the start of the day in a bright salon.',
    ratio: '3 / 2',
    src: '/images/home/stylist-station.webp',
    licence: SUPPLIED,
  },
  closingTogether: {
    id: 'closing-together',
    alt: 'A restaurant team closes up together at the end of the night, putting chairs up and wiping down tables.',
    ratio: '21 / 9',
    src: '/images/home/closing-together.webp',
    position: '50% 38%',
    licence: SUPPLIED,
  },
} satisfies Record<string, LifestyleImage>
