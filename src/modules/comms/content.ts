/**
 * ANNOUNCEMENT CONTENT: a small markup subset, parsed to a typed tree.
 *
 * The brief asks for sanitised rich text. This does something stronger than
 * sanitising: announcement bodies are never HTML at any point. They are stored
 * as text, parsed into the tree below, and rendered as React elements - so
 * there is no `dangerouslySetInnerHTML` anywhere in the communication
 * surfaces, and injection is impossible by construction rather than filtered
 * out by a rule somebody has to keep current.
 *
 * A sanitiser is a denylist you have to keep winning. This is an allowlist of
 * five things, and anything else a person types is text.
 *
 * Supported, because it is what an operational notice actually needs:
 *   paragraphs        blank-line separated
 *   bullet lists      lines starting "- "
 *   numbered lists    lines starting "1. "
 *   bold              **like this**
 *   links             [label](https://example.test)
 *
 * Pure and dependency-free, so every hostile case is exhaustively testable.
 */

export const MAX_BODY_LENGTH = 8000
export const MAX_TITLE_LENGTH = 160

/** Protocols a call to action or inline link may use. */
const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:']

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; href: string }

export type Block =
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'bullets'; items: Inline[][] }
  | { kind: 'numbers'; items: Inline[][] }

/**
 * True when a URL is safe to put in an href.
 *
 * Relative internal paths are allowed so an announcement can point at a page
 * in EverCalm. Everything else must be an absolute http(s) or mailto URL:
 * `javascript:`, `data:` and `vbscript:` are the reason this function exists.
 */
export function isSafeHref(raw: string): boolean {
  const value = raw.trim()
  if (value.length === 0 || value.length > 2000) return false

  // An internal path. Must not be protocol-relative ("//evil.test").
  if (value.startsWith('/')) return !value.startsWith('//')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return SAFE_PROTOCOLS.includes(url.protocol)
}

/**
 * Normalise text on the way in.
 *
 * Deliberately does NOT strip angle brackets: `<` is a legitimate character
 * ("prep <30 min") and React escapes it on render. Removing it would corrupt
 * honest content to defend against a risk that does not exist here.
 */
/**
 * Control characters, minus the ones that carry meaning here.
 *
 * Built from code points rather than written as an escaped character class:
 * a literal class of control characters is unreadable in review and, being
 * invisible, survives a careless edit that changes what it matches. Tab and
 * newline are deliberately kept - they are real formatting in a notice.
 */
const CONTROL_CHARACTERS = new RegExp(
  `[${['\\u0000-\\u0008', '\\u000B', '\\u000C', '\\u000E-\\u001F', '\\u007F'].join('')}]`,
  'g',
)

export function normalizeBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARACTERS, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_BODY_LENGTH)
}

export function normalizeTitle(raw: string): string {
  return raw.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH)
}

const BOLD = /\*\*(.+?)\*\*/
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/

/** Split one line into inline runs. Unmatched syntax stays literal text. */
export function parseInlines(line: string): Inline[] {
  const out: Inline[] = []
  let rest = line

  while (rest.length > 0) {
    const bold = BOLD.exec(rest)
    const link = LINK.exec(rest)

    // Whichever construct comes first wins; neither means the rest is text.
    const boldAt = bold?.index ?? Infinity
    const linkAt = link?.index ?? Infinity
    if (boldAt === Infinity && linkAt === Infinity) {
      out.push({ kind: 'text', text: rest })
      break
    }

    if (linkAt < boldAt && link) {
      if (link.index > 0) out.push({ kind: 'text', text: rest.slice(0, link.index) })
      const label = link[1] ?? ''
      const href = link[2] ?? ''
      // An unsafe URL degrades to plain text rather than being dropped: the
      // reader still sees what was written, it just is not clickable.
      out.push(
        isSafeHref(href)
          ? { kind: 'link', text: label, href: href.trim() }
          : { kind: 'text', text: `${label} (${href})` },
      )
      rest = rest.slice(link.index + link[0].length)
      continue
    }

    if (bold) {
      if (bold.index > 0) out.push({ kind: 'text', text: rest.slice(0, bold.index) })
      out.push({ kind: 'bold', text: bold[1] ?? '' })
      rest = rest.slice(bold.index + bold[0].length)
    }
  }

  return out.filter((i) => i.kind !== 'text' || i.text.length > 0)
}

/** Parse a normalised body into blocks. Never throws. */
export function parseBody(body: string): Block[] {
  const blocks: Block[] = []
  const lines = normalizeBody(body).split('\n')

  let paragraph: string[] = []
  let bullets: string[] = []
  let numbers: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'paragraph', inlines: parseInlines(paragraph.join(' ')) })
    paragraph = []
  }
  const flushBullets = () => {
    if (bullets.length === 0) return
    blocks.push({ kind: 'bullets', items: bullets.map(parseInlines) })
    bullets = []
  }
  const flushNumbers = () => {
    if (numbers.length === 0) return
    blocks.push({ kind: 'numbers', items: numbers.map(parseInlines) })
    numbers = []
  }
  const flushAll = () => {
    flushParagraph()
    flushBullets()
    flushNumbers()
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.length === 0) {
      flushAll()
      continue
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed)
    if (bullet) {
      flushParagraph()
      flushNumbers()
      bullets.push(bullet[1] ?? '')
      continue
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed)
    if (numbered) {
      flushParagraph()
      flushBullets()
      numbers.push(numbered[1] ?? '')
      continue
    }

    flushBullets()
    flushNumbers()
    paragraph.push(trimmed)
  }

  flushAll()
  return blocks
}

/**
 * Flatten to plain text: notification previews, search, and the audit trail.
 * Never used for display, so it deliberately loses structure.
 */
export function bodyToPlainText(body: string): string {
  return parseBody(body)
    .flatMap((block) =>
      block.kind === 'paragraph'
        ? [inlinesToText(block.inlines)]
        : block.items.map((item) => inlinesToText(item)),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function inlinesToText(inlines: Inline[]): string {
  return inlines.map((i) => i.text).join('')
}

/** A short, non-sensitive summary for a delivery record. */
export function preview(body: string, limit = 140): string {
  const text = bodyToPlainText(body)
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`
}
