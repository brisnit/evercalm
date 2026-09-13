import { cn } from '@/lib/cn'

/**
 * Shared furniture for the homepage.
 *
 * The design runs on a strict 1128px content box with a repeating
 * eyebrow / heading / lead opening for every section, so both live here
 * rather than being re-typed eight times.
 */

/** Vertical rhythm shared by every section, so the page keeps one cadence. */
export const SECTION = 'py-16 sm:py-[5.3rem]'

/** The 1128px content box the whole page is measured against. */
export function Container({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('mx-auto w-full max-w-[1168px] px-5', className)}>{children}</div>
}

/** Small uppercase label above a section heading. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-accent-strong font-mono text-[0.6875rem] tracking-[0.18em] uppercase">
      {children}
    </p>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  id,
}: {
  eyebrow: string
  title: React.ReactNode
  lead?: React.ReactNode
  id?: string
}) {
  return (
    <div className="max-w-[44rem]">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        id={id}
        className="font-display text-deep mt-4 text-[2rem] leading-[1.12] font-extrabold tracking-[-0.02em] text-balance sm:text-[2.6rem]"
      >
        {title}
      </h2>
      {lead ? <p className="text-quiet mt-5 text-[1.0625rem] leading-[1.65]">{lead}</p> : null}
    </div>
  )
}
