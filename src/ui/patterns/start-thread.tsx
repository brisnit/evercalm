'use client'

import { useState } from 'react'
import { openThreadAction } from '@/modules/messaging/actions'
import { Button, Field, Select } from '@/ui/primitives'

/**
 * Choosing who to message.
 *
 * The list is built on the server from the people this person is allowed to
 * write to - a manager sees their team, an employee sees the manager they
 * report to - so the control can never offer a conversation the service would
 * then refuse.
 */
export function StartThread({
  people,
  from,
}: {
  people: { id: string; name: string; jobTitle: string | null }[]
  from: 'app' | 'my'
}) {
  const [selected, setSelected] = useState(people[0]?.id ?? '')

  if (people.length === 0) {
    return (
      <p className="text-muted text-sm">
        There is nobody for you to message yet. Your manager can start a conversation with you.
      </p>
    )
  }

  return (
    <form action={openThreadAction} className="flex flex-col gap-3">
      <input type="hidden" name="from" value={from} />
      <Field id="thread-person" label="Who">
        {(p) => (
          <Select
            {...p}
            name="employmentId"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.jobTitle ? ` · ${person.jobTitle}` : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button type="submit" className="self-start">
        Open conversation
      </Button>
    </form>
  )
}
