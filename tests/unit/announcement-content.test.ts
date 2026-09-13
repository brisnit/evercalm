import { describe, expect, it } from 'vitest'
import {
  bodyToPlainText,
  isSafeHref,
  MAX_BODY_LENGTH,
  normalizeBody,
  normalizeTitle,
  parseBody,
  parseInlines,
  preview,
} from '@/modules/comms/content'

/**
 * ANNOUNCEMENT CONTENT.
 *
 * Announcement bodies are the one place a manager's free text reaches every
 * employee's screen, so the hostile cases get as much attention as the happy
 * path. The guarantee under test is structural: the parser only ever emits
 * text, bold, and links with a vetted protocol, so there is nothing for a
 * renderer to be tricked into executing.
 */

describe('link safety', () => {
  it('accepts ordinary web and mail addresses', () => {
    for (const href of [
      'https://example.test/policy',
      'http://example.test',
      'mailto:hr@example.test',
    ]) {
      expect(isSafeHref(href), href).toBe(true)
    }
  })

  it('accepts an internal path', () => {
    expect(isSafeHref('/app/settings/values')).toBe(true)
  })

  it('refuses a protocol-relative URL that would leave the site', () => {
    // "//evil.test" is a real navigation, and it looks like a path.
    expect(isSafeHref('//evil.test')).toBe(false)
  })

  it('refuses every script-bearing protocol', () => {
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(isSafeHref(href), href).toBe(false)
    }
  })

  it('refuses nonsense and absurd lengths', () => {
    expect(isSafeHref('')).toBe(false)
    expect(isSafeHref('not a url')).toBe(false)
    expect(isSafeHref(`https://example.test/${'a'.repeat(2100)}`)).toBe(false)
  })
})

describe('normalisation', () => {
  it('strips control characters but keeps tabs and newlines', () => {
    const raw = `ok${String.fromCharCode(0)}bad${String.fromCharCode(7)}\tkeep\nkeep`
    const result = normalizeBody(raw)
    expect(result).toContain('\t')
    expect(result).toContain('\n')
    expect(result).not.toContain(String.fromCharCode(0))
    expect(result).not.toContain(String.fromCharCode(7))
  })

  it('keeps angle brackets, which are ordinary characters', () => {
    // React escapes these on render. Stripping them would corrupt "prep <30m".
    expect(normalizeBody('prep <30 min & rest')).toBe('prep <30 min & rest')
  })

  it('collapses runs of blank lines and trims', () => {
    expect(normalizeBody('  a\n\n\n\n\nb  ')).toBe('a\n\nb')
  })

  it('normalises CRLF, which is what a pasted document brings', () => {
    expect(normalizeBody('a\r\nb')).toBe('a\nb')
  })

  it('caps the body length', () => {
    expect(normalizeBody('x'.repeat(MAX_BODY_LENGTH + 500))).toHaveLength(MAX_BODY_LENGTH)
  })

  it('flattens a title to one line', () => {
    expect(normalizeTitle('  Menu\nchange   today  ')).toBe('Menu change today')
  })
})

describe('inline parsing', () => {
  it('reads bold', () => {
    expect(parseInlines('line up at **4:45**')).toEqual([
      { kind: 'text', text: 'line up at ' },
      { kind: 'bold', text: '4:45' },
    ])
  })

  it('reads a safe link', () => {
    expect(parseInlines('see [the policy](https://example.test/p)')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'the policy', href: 'https://example.test/p' },
    ])
  })

  it('DEGRADES an unsafe link to text rather than emitting it', () => {
    // The reader still sees what was written; it simply is not clickable.
    const result = parseInlines('click [here](javascript:alert(1))')
    expect(result.every((i) => i.kind !== 'link')).toBe(true)
    expect(result.map((i) => i.text).join('')).toContain('here')
  })

  it('leaves unmatched syntax as literal text', () => {
    expect(parseInlines('2 ** 3 is not bold')).toEqual([
      { kind: 'text', text: '2 ** 3 is not bold' },
    ])
    expect(parseInlines('[unclosed](')).toEqual([{ kind: 'text', text: '[unclosed](' }])
  })

  it('never produces anything but text, bold, and vetted links', () => {
    const hostile = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[x](javascript:alert(1))',
      '<a href="javascript:alert(1)">x</a>',
      '**<svg/onload=alert(1)>**',
    ].join('\n\n')

    for (const block of parseBody(hostile)) {
      const inlines = block.kind === 'paragraph' ? block.inlines : block.items.flat()
      for (const inline of inlines) {
        expect(['text', 'bold', 'link']).toContain(inline.kind)
        if (inline.kind === 'link') expect(isSafeHref(inline.href)).toBe(true)
      }
    }
  })
})

describe('block parsing', () => {
  it('splits paragraphs on blank lines', () => {
    const blocks = parseBody('first para\nsame para\n\nsecond para')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.kind).toBe('paragraph')
  })

  it('reads bullet lists', () => {
    const blocks = parseBody('- one\n- two')
    expect(blocks[0]?.kind).toBe('bullets')
    expect(blocks[0]?.kind === 'bullets' && blocks[0].items).toHaveLength(2)
  })

  it('reads numbered lists', () => {
    const blocks = parseBody('1. first\n2. second\n3) third')
    expect(blocks[0]?.kind).toBe('numbers')
    expect(blocks[0]?.kind === 'numbers' && blocks[0].items).toHaveLength(3)
  })

  it('switches between a paragraph and a list without a blank line', () => {
    const blocks = parseBody('Here is the plan\n- do this\n- then this\nAnd finally.')
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'bullets', 'paragraph'])
  })

  it('never throws, whatever it is given', () => {
    for (const input of ['', '\n\n\n', '-', '1.', '**', '[]()', 'a'.repeat(9000)]) {
      expect(() => parseBody(input)).not.toThrow()
    }
  })
})

describe('plain text and previews', () => {
  it('flattens structure for a delivery record', () => {
    expect(bodyToPlainText('Heads up\n\n- one\n- two')).toBe('Heads up one two')
  })

  it('drops markup from the preview, keeping the words', () => {
    expect(preview('Line up at **4:45** by [the pass](https://example.test)')).toBe(
      'Line up at 4:45 by the pass',
    )
  })

  it('truncates a long preview with an ellipsis', () => {
    const result = preview('word '.repeat(80), 40)
    expect(result.length).toBeLessThanOrEqual(40)
    expect(result.endsWith('…')).toBe(true)
  })
})
