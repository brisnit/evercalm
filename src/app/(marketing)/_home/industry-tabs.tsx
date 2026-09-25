'use client'

import { useId, useState } from 'react'

/**
 * Industry templates, as a real tablist.
 *
 * Keyboard behaviour follows the WAI-ARIA tabs pattern: arrows move between
 * tabs, Home and End jump to the ends, and only the selected tab is in the tab
 * order, so a keyboard user steps past the whole group in one press instead of
 * six.
 */

export interface Industry {
  id: string
  label: string
  title: string
  body: string
  items: string[]
}

export function IndustryTabs({ industries }: { industries: Industry[] }) {
  const [active, setActive] = useState(0)
  const base = useId()
  const current = industries[active] ?? industries[0]
  if (!current) return null

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = industries.length - 1
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null

    if (next === null) return
    event.preventDefault()
    setActive(next)
    document.getElementById(`${base}-tab-${next}`)?.focus()
  }

  return (
    <div className="border-line/70 overflow-hidden rounded-[1.15rem] border bg-white">
      <div
        role="tablist"
        aria-label="Industry templates"
        className="border-line/70 bg-lift flex flex-wrap gap-2 border-b p-3 sm:px-4"
      >
        {industries.map((industry, index) => {
          const selected = index === active
          return (
            <button
              key={industry.id}
              id={`${base}-tab-${index}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${base}-panel-${index}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={
                selected
                  ? 'bg-accent ease-calm min-h-11 rounded-full px-4 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgb(107_77_241/0.7)] transition-colors duration-[320ms]'
                  : 'border-line text-deep hover:border-accent/40 hover:text-accent-strong hover:bg-lift ease-calm min-h-11 rounded-full border bg-white px-4 text-sm font-medium transition-colors duration-[320ms]'
              }
            >
              {industry.label}
            </button>
          )
        })}
      </div>

      {industries.map((industry, index) => (
        <div
          key={industry.id}
          id={`${base}-panel-${index}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${index}`}
          hidden={index !== active}
          tabIndex={0}
          className="grid gap-8 p-6 motion-safe:animate-[ec-fade-in_0.35s_ease-out] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] [&>*]:min-w-0"
        >
          <div>
            <h3 className="font-display text-deep text-2xl font-extrabold tracking-tight">
              {industry.title}
            </h3>
            <p className="text-quiet mt-3 text-[0.9375rem] leading-[1.65]">{industry.body}</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {industry.items.map((item) => (
              <li
                key={item}
                className="border-line/70 bg-lift text-deep flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[0.875rem]"
              >
                <span className="bg-accent h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
