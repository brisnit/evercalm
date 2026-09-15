# Homepage lifestyle imagery: placements and asset brief

Status: **four photographs supplied by the product owner (September 2026) are
in place** for placements 1, 2, 3 and 6. Originals are in `Brand Assets/`
(`1Image.png`–`4Image.png`); web copies are in `public/images/home/` as WebP,
and each is recorded with its alt text, crop focus and source in
`src/app/(marketing)/_home/imagery.ts`. Placements 4 and 5 (industry tabs) are
not used.

Before launch, confirm in writing that the business has the right to use these
images commercially (and, if any show identifiable real people or venues, the
releases for them), and record that reference in `imagery.ts`.

## Direction

- **Candid working moments, not posed stock.** People mid-task, looking at the
  work, not the camera. Natural light where the venue has it; practical
  lighting (pendants, back bar, salon mirrors) where it does not.
- **Shift-based work as it really looks.** Before service, between clients,
  the handoff at the pass, a manager checking in beside the station rather than
  across a desk.
- **Diverse people, represented naturally.** Age, ethnicity, body type,
  gender presentation and visible disability across the set, without one image
  carrying "diversity" alone.
- **The product stays the hero.** Photos are supporting, smaller than the UI
  mockups, and never placed behind text. No phones or screens showing another
  product; a phone may appear, screen away or softly out of focus.
- **Palette fit.** Warm neutrals and wood are fine; avoid saturated
  green/teal walls and heavy colour grading that would clash with violet and
  pink. No beige-and-sage "wellness" look.
- **Avoid:** handshakes, pointing at laptops, headsets, empty staged
  restaurants, perfect uniforms, anyone smiling straight at the lens.

## Placements

| #   | Section                                                | Subject                                                                                                     | Shot                                        | Crop and size                                        | Alt text                                                                                            |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Promise ("Four questions") — beside "What's happening" | A server and a line cook at the pass before service, one reading the day's notes on a clipboard             | Medium, eye level, shallow depth            | 4:5 portrait. Supply 1200×1500; displayed ≤ 360×450  | Two restaurant staff at the kitchen pass reading the notes for tonight's service before doors open. |
| 2   | Two experiences — "The console" card                   | A floor manager crouched beside a bartender at the well, talking through the night; tablet held at the side | Medium-wide, candid                         | 3:2 landscape. Supply 1800×1200; displayed ≤ 560×373 | A bar manager checks in with a bartender at their station before the evening shift.                 |
| 3   | Two experiences — "The app" card                       | A stylist setting up their station: towels folded, tools laid out, phone face down on the counter           | Medium, three-quarter from behind the chair | 3:2 landscape. Supply 1800×1200; displayed ≤ 560×373 | A stylist prepares their chair and tools at the start of the day in a salon.                        |
| 4   | Industry templates — Salons & spas tab                 | Two colleagues at the colour bar mixing and checking a formula card together                                | Close-medium, hands and faces in frame      | 16:9. Supply 1920×1080; displayed ≤ 520×293          | Two salon colleagues mix colour together at the colour bar, checking the formula card.              |
| 5   | Industry templates — Restaurants tab                   | A pre-shift huddle of four or five staff standing near the host stand, one person speaking                  | Wide, slightly elevated                     | 16:9. Supply 1920×1080; displayed ≤ 520×293          | A restaurant team gathers for a short pre-shift huddle near the host stand.                         |
| 6   | Final call to action — above the violet panel          | A small team closing up together: chairs up, one person wiping the bar, another counting down the till      | Wide, warm late light                       | 21:9 banner. Supply 2520×1080; displayed ≤ 1128×483  | A restaurant team closes up together at the end of the night.                                       |

Six images is the ceiling; four (1, 2, 3, 6) are enough for a first version.
The hero stays product UI only.

## Technical requirements

- **Format:** AVIF and WebP served through `next/image`, JPEG fallback. Source
  files at the "Supply" size, sRGB, faces sharp at 2×.
- **Loading:** every lifestyle image is below the fold and lazy-loaded
  (`loading="lazy"`), with explicit width and height or an `aspect-ratio` box
  so nothing shifts as it arrives. The hero loads nothing lazily.
- **Weight:** ≤ 180 KB each at displayed size in AVIF.
- **Motion:** at most a gentle fade as the section reveals; honours
  `prefers-reduced-motion` and is visible without JavaScript.
- **Alt text:** as above — describes the moment, never "stock photo" or
  marketing claims.

## Licensing before anything is committed

- A written licence covering web and marketing use for the business, with
  model releases for every identifiable person and property releases for any
  recognisable venue.
- Preferably commissioned at a real pilot customer, with their written consent,
  so the people shown work in the kind of place EverCalm serves.
- Stored with the licence reference in `Brand Assets/licensed/`, and the
  licence reference recorded in `imagery.ts` beside each file.
