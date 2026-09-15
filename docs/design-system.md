# Design system

Tokens live in `src/app/globals.css` under `@theme`. A live reference renders
every primitive in every state at **`/design`** (development only).

## Colour

Every value was **measured** against WCAG 2.2 AA, not assumed. Two measurements
constrain the whole system:

| Token                    | Hex       |             On white | Verdict                      |
| ------------------------ | --------- | -------------------: | ---------------------------- |
| `ink`                    | `#040404` |              20.50:1 | AAA — body and headings      |
| `violet-600` **primary** | `#7C24F5` |               6.13:1 | AA — text and button fills   |
| `violet-700`             | `#6B17DB` |               7.58:1 | AAA — hover, active          |
| `violet-300`             | `#A56BFF` | 4.88:1 _on charcoal_ | AA on dark surfaces          |
| `pink-500` **brand**     | `#EA33A9` |           **3.79:1** | **FAILS AA for normal text** |
| `pink-700`               | `#B8177F` |               6.06:1 | AA — pink _text_             |
| `pink-300`               | `#F27ACA` | 6.68:1 _on charcoal_ | AA on dark surfaces          |
| `muted`                  | `#5A5766` |               7.02:1 | AAA — secondary text         |
| `faint`                  | `#66627A` |               5.84:1 | AA — tertiary text           |
| `success`                | `#146C43` |               6.45:1 | AA                           |
| `warning`                | `#8C5200` |               6.32:1 | AA                           |
| `danger`                 | `#C02626` |               5.92:1 | AA                           |
| `info`                   | `#1D4FD8` |               6.64:1 | AA                           |

### Three rules this produces

1. **Brand pink is never small text on white.** It is a display (≥24px), fill,
   border, and icon colour. Pink text uses `pink-700`.
2. **Brand violet fails on charcoal (2.72:1).** Dark surfaces use `violet-300`.
   "Use the brand colour everywhere" would have broken every dark section.
3. `#00C2E0` cyan is **decorative only** at 2.14:1 — illustration and fills,
   never text and never an icon carrying meaning alone. The usable blue accent
   is `info #1D4FD8`.

> `faint` was originally `#7A7688` and shipped failing at 4.40:1. The axe scan
> in `tests/e2e/accessibility.spec.ts` caught it. That is the scan earning its
> place — measure, do not eyeball.

Semantic colour (success/warning/danger/info) is deliberately separate from the
brand accent, so "this needs attention" never competes with "this is EverCalm".

### Grounds and edges (refinement pass, September 2026)

| Token         | Hex       | Use                                                                       | Measured                                                 |
| ------------- | --------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `canvas`      | `#F5F2FD` | Application ground behind white surfaces (admin, employee, EverCalm team) | muted 6.36:1, faint 5.29:1, violet-600 5.54:1 on it      |
| `field`       | `#878299` | Boundary of every text input, select and textarea                         | 3.70:1 on white, 3.34:1 on canvas (WCAG 1.4.11 asks 3:1) |
| `line-strong` | `#CFCAD9` | Dividers and card edges only — never a control boundary                   | 1.6:1                                                    |

The product's surfaces are white cards on pale lavender. Violet marks what is
current (navigation, selected tab) and what is primary; hot pink marks the one
thing that needs a person, and completion moments.

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

## Deliberately avoided

Beige and sage palettes · tiny eyebrow text · decorative dots and dashes ·
walls of identical-weight cards · low-contrast buttons · ambiguous clickability
· gratuitous gradients · dashboards of vanity metrics. **Every number on a
dashboard must be something a person can act on** — which is why the Slice 1
overview shows access and locations rather than a row of zeroes.
