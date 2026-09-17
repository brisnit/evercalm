# Design system

Tokens live in `src/app/globals.css` under `@theme`. A live reference renders
every primitive in every state at **`/design`** (development only).

## Colour

The stakeholder palette (round 1, September 2026) is the source of truth:

| Stakeholder colour | Hex       | Role in the product                         |
| ------------------ | --------- | ------------------------------------------- |
| **Navy**           | `#1E2D3D` | Primary text, headings, dark surfaces       |
| **Deep Teal**      | `#2A5C5A` | Primary actions, selected navigation, links |
| **Soft Sage**      | `#7FB5A0` | Secondary accents, success, progress        |
| **Warm Sand**      | `#F5E6D3` | Calm backgrounds and highlighted surfaces   |
| **Coral Pop**      | `#E8856C` | Selective attention and warning emphasis    |

Every value was **measured** against WCAG 2.2 AA, not assumed. Three of the
five fail as small text on white, which is what the derived variants are for.

| Token                  | Hex       |             On white | On canvas | Verdict                          |
| ---------------------- | --------- | -------------------: | --------: | -------------------------------- |
| `ink` (navy-800)       | `#1E2D3D` |              14.02:1 |   13.02:1 | AAA — body and headings          |
| `charcoal` (navy-900)  | `#14202C` |              16.50:1 |         — | dark section ground              |
| `teal-600` **primary** | `#2A5C5A` |               7.56:1 |    7.02:1 | AAA — link text and button fills |
| `teal-700`             | `#234B49` |               9.66:1 |    8.97:1 | AAA — small accent text, hover   |
| `teal-500`             | `#35706D` |               5.69:1 |    5.29:1 | AA — focus rings, hover fills    |
| `teal-300`             | `#7FB5B0` | 7.18:1 _on charcoal_ |         — | AA on dark surfaces              |
| `sage-400` **brand**   | `#7FB5A0` |           **2.33:1** |         — | **fills, borders, icons only**   |
| `sage-300`             | `#A6D0BE` | 9.73:1 _on charcoal_ |         — | AA on dark surfaces              |
| `sand-200` **brand**   | `#F5E6D3` |           **1.23:1** |         — | **a surface colour, never text** |
| `coral-400` **brand**  | `#E8856C` |           **2.62:1** |         — | **fills, borders, icons only**   |
| `coral-300`            | `#F0A68F` | 8.29:1 _on charcoal_ |         — | AA on dark surfaces              |
| `muted` (navy-500)     | `#4E5A68` |               7.03:1 |    6.53:1 | AAA on white — secondary text    |
| `faint` (navy-400)     | `#67727F` |               4.89:1 |    4.55:1 | AA — tertiary text               |

### Derived colours, and why each exists

Each stakeholder colour that cannot carry small text has exactly one darker
variant. The stakeholder colour itself stays as fills, borders, icons and
large display accents, so the palette still reads as theirs.

| Derived token           | Hex                   | Derived from         |        On white | Exists because                                                            |
| ----------------------- | --------------------- | -------------------- | --------------: | ------------------------------------------------------------------------- |
| `sage-700` / `success`  | `#2E6B54`             | Soft Sage            |          6.27:1 | Soft Sage is 2.33:1; success **text**, ticks and "Verified" need AA       |
| `coral-700` / `warning` | `#A34128`             | Coral Pop            |          6.28:1 | Coral Pop is 2.62:1; warning **text** and "Overdue" labels need AA        |
| `teal-700`              | `#234B49`             | Deep Teal            |          9.66:1 | Small accent text and hover/active depth over the 7.56:1 brand teal       |
| `teal-500`              | `#35706D`             | Deep Teal            |          5.69:1 | Focus rings and secondary hover fills that must stay distinct from rest   |
| `teal-300`              | `#7FB5B0`             | Deep Teal            |               — | Deep Teal is 2.18:1 on navy-900; dark surfaces need a light teal (7.18:1) |
| `sage-300`              | `#A6D0BE`             | Soft Sage            |               — | Same reason on dark grounds (9.73:1 on charcoal)                          |
| `coral-300`             | `#F0A68F`             | Coral Pop            |               — | Same reason on dark grounds (8.29:1 on charcoal)                          |
| `navy-500` (`muted`)    | `#4E5A68`             | Navy                 |          7.03:1 | Secondary text that is navy-family but lighter than `ink`                 |
| `navy-400` (`faint`)    | `#67727F`             | Navy                 |          4.89:1 | Tertiary text, the lightest navy that still passes AA                     |
| `field`                 | `#7C8794`             | Navy                 |          3.65:1 | Control boundaries need 3:1 (WCAG 1.4.11); 3.39:1 on canvas               |
| `line` / `line-strong`  | `#EAE3D9` / `#D6CCBE` | Warm Sand            | 1.27:1 / 1.59:1 | Dividers and card edges, warmed to sit on sand rather than grey           |
| `canvas`                | `#FAF6F0`             | Warm Sand            |               — | The application ground: a calm sand tint that keeps every text token AA   |
| `raise` / `sunk`        | `#FDFBF8` / `#F3EDE5` | Warm Sand            |               — | Raised and recessed surfaces within a card                                |
| `mist`                  | `#F1E9DE`             | Warm Sand            |               — | Deeper marketing section ground                                           |
| `danger`                | `#A8172B`             | (not in the palette) |          7.44:1 | Destructive actions must never read as a coral accent — see below         |
| `info`                  | `#26557A`             | (not in the palette) |          7.89:1 | Neutral information that is not a primary action                          |

### Four rules this produces

1. **Soft Sage, Warm Sand and Coral Pop are never small text on white.** They
   are display (≥24px), fill, border and icon colours. Their text forms are
   `sage-700` and `coral-700`; Warm Sand is never text at all.
2. **Deep Teal fails on dark grounds (2.18:1 on navy-900).** Dark surfaces use
   `teal-300`, `sage-300` and `coral-300`.
3. **Destructive stays crimson.** `danger #A8172B` deliberately shares no hue
   with Coral Pop, so "delete this" and "worth a look" can never be confused.
   Coral carries attention and warning; crimson carries loss and failure.
4. **Semantic colour stays separate from the brand accent**, so "this needs
   attention" never competes with "this is EverCalm".

> `faint` was originally `#7A7688` and shipped failing at 4.40:1. The axe scan
> in `tests/e2e/accessibility.spec.ts` caught it. That is the scan earning its
> place — measure, do not eyeball.

### Grounds and edges

| Token         | Hex       | Use                                                                       | Measured                                                 |
| ------------- | --------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `canvas`      | `#FAF6F0` | Application ground behind white surfaces (admin, employee, EverCalm team) | muted 6.53:1, faint 4.55:1, teal-600 7.02:1 on it        |
| `field`       | `#7C8794` | Boundary of every text input, select and textarea                         | 3.65:1 on white, 3.39:1 on canvas (WCAG 1.4.11 asks 3:1) |
| `line-strong` | `#D6CCBE` | Dividers and card edges only — never a control boundary                   | 1.59:1                                                   |

The product's surfaces are white cards on warm sand. Deep Teal marks what is
current (navigation, selected tab) and what is primary; Soft Sage marks
progress and completion; Coral Pop marks the one thing that needs a person.

**Disabled controls** sit at 60% opacity, which drops white-on-teal to about
2.6:1. WCAG 2.2 exempts inactive components (1.4.3), and disabled state is
never the only signal — the control is also unclickable and, where it matters,
explained in words.

## Type

The lockup pairs an italic high-contrast serif ("Ever") with a heavy geometric
sans ("Calm."). The system follows the logo rather than inventing a new voice.

| Role                | Face                            | Usage                                                                      |
| ------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| Display             | **Plus Jakarta Sans** ExtraBold | Headings. Tight tracking.                                                  |
| Editorial accent    | **Fraunces** Italic             | Marketing only, at most one phrase per page. A seasoning, not a body font. |
| Product UI and body | **Inter**                       | Everything else.                                                           |

Numbers that line up in columns get `font-variant-numeric: tabular-nums`,
applied automatically to `table` and anything marked `data-tabular`.

## Shape and elevation

`--radius-control` 10px · `--radius-card` 12px · `--radius-panel` 20px.
Tailwind v4 generates `rounded-control` / `rounded-card` / `rounded-panel` from
these. (Use those utilities — `rounded-[--radius-control]` is v3 syntax and
emits invalid CSS that silently does nothing.)

Two shadows only. **Borders do the structural work**; shadow is reserved for
the one thing that needs lifting. Not everything is a card.

The violet→pink gradient is reserved for three uses: the primary marketing CTA,
one hero accent, and progress rings.

## Components to reach for

| Need                              | Use                                                             | Not                               |
| --------------------------------- | --------------------------------------------------------------- | --------------------------------- |
| The page's main action, as a link | `ButtonLink`                                                    | a `Link` with button classes      |
| A link in or beside text          | `TextLink` (`standalone` when it sits alone: 44px hit area)     | colour-only violet text           |
| Up from a detail page             | `PageHeader back={…}` or `BackLink`                             | "← Label" text                    |
| A choice                          | `Select`                                                        | a private `SELECT` class string   |
| Free text                         | `Textarea`                                                      | a private `TEXTAREA` class string |
| A figure to act on                | `StatTile` — zero renders quiet; problems carry a coloured edge | tinted tiles for every number     |
| Section navigation                | `AppNav` (top), `SectionNav` (within a section)                 | per-page link rows                |

**One primary action per view.** When several things could be done, the most
important is `primary` and the rest are `secondary` or text links. A refusal
(deny, decline, remove) is never styled as the primary.

**Eyebrows carry context, not the nav.** `PageHeader eyebrow` is plain muted
text for real context (the location); it never repeats the section the
navigation already marks.

## Accessibility baseline — WCAG 2.2 AA

- Visible focus ring on everything focusable, 2px at 2px offset. Never removed.
- A skip link is the first tab stop on every page.
- 44px minimum touch targets on employee screens.
- Labels are real `<label>` elements bound by `id`; errors use `role="alert"`
  and are linked by `aria-describedby`.
- **No meaning by colour alone** — every `Badge` carries text.
- Horizontally scrollable content uses `ScrollArea`, which is focusable and
  named. A scroll container that is not focusable is a keyboard trap.
- `prefers-reduced-motion` is honoured globally.
- Empty, loading, and error states are primitives (`EmptyState`,
  `LoadingState`, `ErrorState`), so a view without all three is incomplete.

Every screen is scanned by axe at desktop **and** phone width in CI. Any
violation fails the build.

## Brand assets

`src/ui/brand.ts` is the only file that knows where artwork lives. Layouts size
the mark from `aspectRatio`, never from pixel dimensions, so **replacing the
temporary PNG with a production SVG is a change to that one file** and nothing
reflows.

The wordmark is dark type on transparency, so on dark grounds it sits on a
light chip rather than being colour-inverted — inverting would turn the brand
gradient green.

**The wordmark carries the palette, part by part** (September 2026, at the
owner's request):

| Part          | Colour              | On white | On navy |
| ------------- | ------------------- | -------: | ------: |
| Wordmark      | Navy `#1E2D3D`      |  14.02:1 |  1.18:1 |
| Hands         | Deep Teal `#2A5C5A` |   7.56:1 |  2.18:1 |
| Central light | Coral Pop `#E8856C` |   2.62:1 |  6.29:1 |
| Rays          | Soft Sage `#7FB5A0` |   2.33:1 |  7.09:1 |

`scripts/recolour-wordmark.py` separates the parts by connected components on
the supplied artwork and rewrites colour only — every pixel keeps its original
alpha, so letterforms, proportions and the hand/light drawing are exactly as
supplied (verified: zero pixels differ in alpha from the original).

Two assets come out of it. `evercalm-wordmark-brand.png` is the mark.
`evercalm-wordmark-brand-on-dark.png` changes only the two colours that fail on
a navy ground — the wordmark to Warm Sand (13.47:1) and the hands to the light
teal used on dark surfaces (7.18:1) — so the light chip is no longer needed.
The original black and violet/magenta artwork is untouched at
`evercalm-wordmark.png`; reverting is one line in `src/ui/brand.ts`.

A logotype is exempt from contrast minimums (WCAG 1.4.3, 1.4.11), but the mark
was measured anyway and is legible at 22px through 72px on white, the canvas
ground, Warm Sand and navy.

## Deliberately avoided

Tiny eyebrow text · decorative dots and dashes ·
walls of identical-weight cards · low-contrast buttons · ambiguous clickability
· gratuitous gradients · dashboards of vanity metrics. **Every number on a
dashboard must be something a person can act on** — which is why the Slice 1
overview shows access and locations rather than a row of zeroes.
