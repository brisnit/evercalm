import { parseBody, type Inline } from '@/modules/comms/content'

/**
 * Render an announcement body.
 *
 * The body is parsed to a typed tree and emitted as React elements. There is
 * no `dangerouslySetInnerHTML` here and there must never be one: that is what
 * makes the content safe, rather than a sanitiser that has to keep winning.
 *
 * Links carry `rel="noreferrer"` and open in place. External navigation from
 * an announcement is rare enough not to justify surprising people with a new
 * tab.
 */
export function AnnouncementBody({ body }: { body: string }) {
  const blocks = parseBody(body)

  return (
    <div className="flex flex-col gap-3.5">
      {blocks.map((block, index) => {
        if (block.kind === 'paragraph') {
          return (
            <p key={index} className="text-ink text-[0.9375rem] leading-[1.65]">
              <Inlines inlines={block.inlines} />
            </p>
          )
        }
        if (block.kind === 'bullets') {
          return (
            <ul key={index} className="flex list-disc flex-col gap-1.5 pl-5">
              {block.items.map((item, i) => (
                <li key={i} className="text-ink text-[0.9375rem] leading-[1.6]">
                  <Inlines inlines={item} />
                </li>
              ))}
            </ul>
          )
        }
        return (
          <ol key={index} className="flex list-decimal flex-col gap-1.5 pl-5">
            {block.items.map((item, i) => (
              <li key={i} className="text-ink text-[0.9375rem] leading-[1.6]">
                <Inlines inlines={item} />
              </li>
            ))}
          </ol>
        )
      })}
    </div>
  )
}

function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((inline, index) => {
        if (inline.kind === 'bold') {
          return (
            <strong key={index} className="font-semibold">
              {inline.text}
            </strong>
          )
        }
        if (inline.kind === 'link') {
          return (
            <a
              key={index}
              href={inline.href}
              rel="noreferrer"
              className="text-violet-700 underline underline-offset-2"
            >
              {inline.text}
            </a>
          )
        }
        return <span key={index}>{inline.text}</span>
      })}
    </>
  )
}
