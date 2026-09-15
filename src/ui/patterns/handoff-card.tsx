'use client'

import {
  acknowledgeHandoffAction,
  reopenHandoffAction,
  resolveHandoffAction,
} from '@/modules/operations/actions'
import type { HandoffView } from '@/modules/operations/handoffs'
import { Badge, Disclosure, Field, Textarea } from '@/ui/primitives'
import { MiniForm } from './mini-form'

/**
 * One handoff: what it is about, who left it on which shift, who has read it,
 * and - for a manager at the location - resolving or reopening it.
 */
export function HandoffCard({
  handoff,
  allowAcknowledge = true,
}: {
  handoff: HandoffView
  allowAcknowledge?: boolean
}) {
  const resolved = handoff.status === 'resolved'
  return (
    <article
      className="rounded-control border-line flex flex-col gap-2 border bg-white p-4"
      aria-label={`Handoff: ${handoff.title}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={handoff.category === 'safety' ? 'danger' : 'neutral'}>
          {handoff.categoryLabel}
        </Badge>
        {handoff.priority === 'urgent' ? <Badge tone="warning">Priority</Badge> : null}
        {resolved ? <Badge tone="success">Resolved</Badge> : <Badge tone="info">Open</Badge>}
      </div>
      <h3 className="text-ink font-medium text-balance">{handoff.title}</h3>
      {handoff.body ? (
        <p className="text-ink/85 text-sm whitespace-pre-line">{handoff.body}</p>
      ) : null}
      <p className="text-muted text-xs">
        {handoff.authorName}
        {handoff.shiftLabel ? ` · shift ${handoff.shiftLabel}` : ''} · left {handoff.createdLabel}
      </p>
      {resolved ? (
        <p className="text-success text-sm">
          Resolved by {handoff.resolvedByName ?? 'a manager'}
          {handoff.resolvedAtLabel ? `, ${handoff.resolvedAtLabel}` : ''}
          {handoff.resolutionNote ? `: ${handoff.resolutionNote}` : '.'}
        </p>
      ) : null}
      {handoff.acknowledgements.length > 0 ? (
        <p className="text-muted text-xs">
          Read by {handoff.acknowledgements.map((a) => a.name).join(', ')}
        </p>
      ) : null}

      <div className="mt-1 flex flex-wrap items-start gap-2">
        {allowAcknowledge && !resolved && !handoff.isMine && !handoff.acknowledgedByMe ? (
          <MiniForm
            action={acknowledgeHandoffAction}
            hidden={{ handoffId: handoff.id }}
            submitLabel="I’ve read this"
          />
        ) : null}
        {allowAcknowledge && handoff.acknowledgedByMe && !resolved ? (
          <p className="text-muted min-h-11 content-center text-sm">You’ve read this.</p>
        ) : null}
        {handoff.canResolve && resolved ? (
          <MiniForm
            action={reopenHandoffAction}
            hidden={{ handoffId: handoff.id }}
            submitLabel="Reopen"
            variant="ghost"
          />
        ) : null}
      </div>
      {handoff.canResolve && !resolved ? (
        <Disclosure label="Resolve">
          <MiniForm
            action={resolveHandoffAction}
            hidden={{ handoffId: handoff.id }}
            submitLabel="Mark resolved"
          >
            <Field
              id={`resolve-${handoff.id}`}
              label="What was done"
              hint="Optional. The person who left it is told."
            >
              {(p) => <Textarea {...p} name="note" rows={2} maxLength={300} />}
            </Field>
          </MiniForm>
        </Disclosure>
      ) : null}
    </article>
  )
}
