'use client'

import { Fragment, useActionState, useRef, useState } from 'react'
import {
  confirmImportAction,
  previewImportAction,
  type ImportActionState,
} from '@/modules/people/import-actions'
import {
  FIELD_LABELS,
  IMPORT_FIELDS,
  importTemplateCsv,
  MAX_IMPORT_ROWS,
  type ImportField,
} from '@/modules/people/csv'
import type { ImportPreview } from '@/modules/people/import-service'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  ScrollArea,
  Select,
} from '@/ui/primitives'

const INITIAL: ImportActionState = { status: 'idle' }

/**
 * The import wizard: choose a file, map columns, review every row, confirm.
 *
 * The raw file text travels with each step in a hidden field, and the server
 * re-validates it from scratch each time. Nothing this component computes is
 * trusted by the write path.
 *
 * Downloads are produced in the browser from data already on screen, so no new
 * server endpoint exists that could return people data.
 */
export function ImportWizard() {
  const [preview, previewAction, previewing] = useActionState(previewImportAction, INITIAL)
  const [confirmed, confirmAction, confirming] = useActionState(confirmImportAction, INITIAL)
  const [mapping, setMapping] = useState<Record<number, ImportField>>({})
  const [dragging, setDragging] = useState(false)
  const [chosenFile, setChosenFile] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const result = preview.preview
  const activeMapping = Object.keys(mapping).length > 0 ? mapping : (result?.mapping ?? {})

  if (confirmed.status === 'imported' && confirmed.outcome) {
    // The preview is handed on so the rows that were skipped can still be
    // downloaded and fixed. Losing the report at the moment somebody learns
    // three rows failed would make them re-upload just to see why.
    return <ImportComplete state={confirmed} skippedReport={result ?? null} />
  }

  function download(name: string, contents: string) {
    const blob = new Blob([contents], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Step 1 - the file */}
      <Card>
        <CardHeader
          title="1. Choose your file"
          description={`A CSV of up to ${MAX_IMPORT_ROWS} people, 1 MB at most.`}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => download('evercalm-import-template.csv', importTemplateCsv())}
            >
              Download template
            </Button>
          }
        />
        <div className="p-5">
          <form action={previewAction} className="flex flex-col gap-3">
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const dropped = e.dataTransfer.files[0]
                if (dropped && fileInput.current) {
                  const transfer = new DataTransfer()
                  transfer.items.add(dropped)
                  fileInput.current.files = transfer.files
                  setChosenFile(dropped.name)
                }
              }}
              className={
                dragging
                  ? 'rounded-card border-2 border-dashed border-teal-600 bg-teal-50 p-6 text-center'
                  : 'rounded-card border-line-strong bg-raise border-2 border-dashed p-6 text-center'
              }
            >
              <label
                htmlFor="import-file"
                className="text-ink cursor-pointer text-sm font-medium underline underline-offset-4"
              >
                Choose a CSV file
              </label>
              <span className="text-muted block text-sm"> or drag one here</span>
              {/*
                The native control is hidden rather than shown alongside the
                label: two ways to pick a file is confusing, and the unstyled
                input has an intrinsic width that pushed the whole page wider
                than a phone screen. `sr-only` keeps it focusable and operable
                by keyboard and by assistive technology.
              */}
              <input
                ref={fileInput}
                id="import-file"
                type="file"
                name="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => setChosenFile(e.target.files?.[0]?.name ?? null)}
              />
              <p aria-live="polite" className="text-ink mt-3 text-sm font-medium">
                {chosenFile ?? <span className="text-muted font-normal">No file chosen yet</span>}
              </p>
            </div>

            {preview.status === 'error' && preview.message ? (
              <p
                role="alert"
                data-testid="import-error"
                className="rounded-control border-danger/30 bg-danger-soft text-danger border px-3 py-2.5 text-sm font-medium"
              >
                {preview.message}
              </p>
            ) : null}

            <Button type="submit" loading={previewing} className="self-start">
              Read the file
            </Button>
          </form>
        </div>
      </Card>

      {/* Step 2 - mapping */}
      {result ? (
        <Card>
          <CardHeader
            title="2. Match your columns"
            description={`Read ${preview.fileName ?? 'your file'}. Change anything we guessed wrong.`}
          />
          <div className="p-5">
            <form action={previewAction} className="flex flex-col gap-4">
              <input type="hidden" name="csvText" value={preview.csvText ?? ''} />
              <input type="hidden" name="fileName" value={preview.fileName ?? ''} />
              <input type="hidden" name="mapping" value={JSON.stringify(activeMapping)} />

              {/* Which side is which was not stated anywhere on this step. */}
              <div
                aria-hidden="true"
                className="text-faint grid grid-cols-2 gap-3 text-xs font-semibold tracking-wide uppercase"
              >
                <span>Column in your file</span>
                <span>Becomes</span>
              </div>

              <ul className="flex flex-col gap-2">
                {result.headers.map((header, index) => (
                  <li key={`${header}-${index}`} className="grid grid-cols-2 items-center gap-3">
                    <span className="text-ink truncate text-sm font-medium">
                      {header || <span className="text-faint">Column {index + 1}</span>}
                    </span>
                    <label className="sr-only" htmlFor={`map-${index}`}>
                      What is “{header || `column ${index + 1}`}”?
                    </label>
                    <Select
                      id={`map-${index}`}
                      value={activeMapping[index] ?? ''}
                      onChange={(e) => {
                        const next = { ...activeMapping }
                        if (e.target.value === '') delete next[index]
                        else next[index] = e.target.value as ImportField
                        setMapping(next)
                      }}
                    >
                      <option value="">Do not import</option>
                      {IMPORT_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {FIELD_LABELS[field]}
                        </option>
                      ))}
                    </Select>
                  </li>
                ))}
              </ul>

              <Button type="submit" variant="secondary" loading={previewing} className="self-start">
                Re-check with these columns
              </Button>
            </form>
          </div>
        </Card>
      ) : null}

      {/* Step 3 - review */}
      {result && !result.fileError ? (
        <Card>
          <CardHeader
            title="3. Review every row"
            description="Nothing has been created yet."
            action={
              result.invalidCount > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => download('evercalm-import-errors.csv', buildErrorCsv(result))}
                >
                  Download error report
                </Button>
              ) : undefined
            }
          />
          <div className="p-5">
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge tone={result.validCount > 0 ? 'success' : 'neutral'}>
                {result.validCount} ready to import
              </Badge>
              <Badge tone={result.invalidCount > 0 ? 'danger' : 'neutral'}>
                {result.invalidCount} with problems
              </Badge>
              {result.unmappedHeaders.length > 0 ? (
                <Badge tone="neutral">{result.unmappedHeaders.length} columns ignored</Badge>
              ) : null}
            </div>

            {result.rows.length === 0 ? (
              <EmptyState
                title="No rows found"
                description="That file has a header but no people."
              />
            ) : (
              <ScrollArea label="Import preview, scrollable horizontally">
                <table className="w-full min-w-[38rem] table-fixed text-sm">
                  <caption className="sr-only">
                    Every row in the file and whether it can be imported
                  </caption>
                  {/*
                    Fixed proportions, because automatic layout gave the email
                    column most of the width and broke people's names across
                    three lines.
                  */}
                  <colgroup>
                    <col className="w-[6%]" />
                    <col className="w-[23%]" />
                    <col className="w-[25%]" />
                    <col className="w-[16%]" />
                    <col className="w-[14%]" />
                    <col className="w-[16%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-line-strong bg-sunk border-b text-left">
                      {['Line', 'Name', 'Email', 'Location', 'Role', 'Status'].map((h) => (
                        <th
                          key={h}
                          scope="col"
                          className="text-muted px-3 py-2.5 text-xs font-semibold tracking-wide uppercase"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <Fragment key={row.lineNumber}>
                        <tr
                          className={
                            row.valid ? 'border-line border-b last:border-b-0' : 'bg-danger-soft/40'
                          }
                        >
                          <td className="text-muted px-3 py-2.5 tabular-nums">{row.lineNumber}</td>
                          <td className="text-ink px-3 py-2.5 break-words">
                            {row.displayName || '—'}
                          </td>
                          {/* Long addresses wrap rather than run into the next column. */}
                          <td className="text-muted px-3 py-2.5 break-all">{row.email || '—'}</td>
                          <td className="text-muted px-3 py-2.5">{row.locationName ?? '—'}</td>
                          <td className="text-muted px-3 py-2.5">{row.jobRoleName ?? '—'}</td>
                          <td className="px-3 py-2.5">
                            {row.valid ? (
                              <Badge tone="success">Ready</Badge>
                            ) : (
                              <Badge tone="danger">Skipped</Badge>
                            )}
                          </td>
                        </tr>
                        {/*
                          Why a row was skipped runs across the full width
                          rather than inside the status cell, where a sentence
                          explaining the problem was breaking one word per line.
                        */}
                        {row.valid ? null : (
                          <tr className="border-line bg-danger-soft/40 border-b last:border-b-0">
                            <td />
                            <td colSpan={5} className="text-danger px-3 pb-2.5 text-xs">
                              {row.issues.map((i) => i.message).join(' ')}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </div>
        </Card>
      ) : null}

      {/* Step 4 - confirm */}
      {result && !result.fileError && result.validCount > 0 ? (
        <Card>
          <CardHeader title="4. Confirm" description="This is the point of no return." />
          <div className="p-5">
            <form action={confirmAction} className="flex flex-col gap-4">
              <input type="hidden" name="csvText" value={preview.csvText ?? ''} />
              <input type="hidden" name="mapping" value={JSON.stringify(activeMapping)} />

              {confirmed.status === 'error' && confirmed.message ? (
                <p
                  role="alert"
                  className="rounded-control border-danger/30 bg-danger-soft text-danger border px-3 py-2.5 text-sm font-medium"
                >
                  {confirmed.message}
                </p>
              ) : null}

              <p className="rounded-control border-line bg-sunk text-ink border px-4 py-3 text-sm">
                {result.validCount} {result.validCount === 1 ? 'person' : 'people'} will be added to
                your directory
                {result.invalidCount > 0
                  ? `, and ${result.invalidCount} ${result.invalidCount === 1 ? 'row' : 'rows'} will be skipped`
                  : ''}
                . They will appear as invited and cannot sign in yet.
              </p>

              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="sendInvitations" className="mt-0.5 size-4" />
                <span>
                  <span className="text-ink font-medium">Also send each of them an invitation</span>
                  <span className="text-muted block text-xs">
                    Leave this unticked to add them quietly and invite people later. Email is in
                    development-safe mode, so nothing actually leaves this machine yet.
                  </span>
                </span>
              </label>

              <Button type="submit" loading={confirming} className="self-start">
                Import {result.validCount} {result.validCount === 1 ? 'person' : 'people'}
              </Button>
            </form>
          </div>
        </Card>
      ) : null}
    </div>
  )
}

function ImportComplete({
  state,
  skippedReport,
}: {
  state: ImportActionState
  skippedReport: ImportPreview | null
}) {
  const outcome = state.outcome!

  function download(name: string, contents: string) {
    const blob = new Blob([contents], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.click()
    URL.revokeObjectURL(url)
  }
  return (
    <Card>
      <CardHeader title="Import complete" />
      <div className="p-5">
        <p
          role="status"
          className="rounded-control border-success/30 bg-success-soft text-success border px-4 py-3 text-sm font-medium"
        >
          {state.message}
        </p>

        <dl className="mt-5 flex flex-col gap-3 text-sm">
          {[
            ['Added to the directory', String(outcome.imported)],
            ['Skipped', String(outcome.skipped)],
            ['Invitations sent', String(outcome.invited)],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted">{label}</dt>
              <dd className="text-ink font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/app/people">View the directory</ButtonLink>
          <ButtonLink href="/app/people/import" variant="secondary">
            Import another file
          </ButtonLink>
          {outcome.skipped > 0 && skippedReport ? (
            <Button
              variant="secondary"
              onClick={() => download('evercalm-import-errors.csv', buildErrorCsv(skippedReport))}
            >
              Download the skipped rows
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

/**
 * Build the error report in the browser from what is already on screen.
 *
 * Cells are escaped the same way the server does: a value starting with =, +,
 * - or @ is prefixed so a spreadsheet treats it as text rather than executing
 * it. The uploaded file is untrusted, and this report echoes it back.
 */
function buildErrorCsv(preview: NonNullable<ImportActionState['preview']>): string {
  const escape = (value: string): string => {
    const raw = value ?? ''
    const neutralised = /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw
    return /[",\n\r]/.test(neutralised) ? `"${neutralised.replace(/"/g, '""')}"` : neutralised
  }
  const rows = [['Line', 'Full name', 'Email', 'Problem']]
  for (const row of preview.rows) {
    if (row.valid) continue
    rows.push([
      String(row.lineNumber),
      row.displayName,
      row.email,
      row.issues.map((i) => i.message).join(' '),
    ])
  }
  return rows.map((r) => r.map(escape).join(',')).join('\r\n')
}
