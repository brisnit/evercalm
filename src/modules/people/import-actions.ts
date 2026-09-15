'use server'

import { demoRestriction } from '@/server/demo'
import { revalidatePath } from 'next/cache'
import { getEnv } from '@/lib/env'
import { readString } from '@/lib/form'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import { withTenant } from '@/server/db'
import { requireActorContext } from '@/server/auth/session'
import {
  ACCEPTED_MIME_TYPES,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  IMPORT_FIELDS,
  type ImportField,
} from './csv'
import { previewImport, runImport, type ImportPreview, type ImportOutcome } from './import-service'

/**
 * CSV import actions.
 *
 * The preview and the confirmation both carry the RAW FILE TEXT, and the
 * confirmation re-parses and re-validates it from scratch. Nothing the preview
 * computed is trusted as input to the write - so a hand-crafted post cannot
 * hand the importer pre-approved rows.
 */

export interface ImportActionState {
  status: 'idle' | 'previewed' | 'imported' | 'error'
  message?: string
  /** Carried between steps so confirmation validates the same bytes. */
  csvText?: string
  fileName?: string
  preview?: ImportPreview
  outcome?: ImportOutcome
}

function fail(error: unknown, fallback: string): ImportActionState {
  if (error instanceof ValidationError) return { status: 'error', message: error.message }
  if (error instanceof ForbiddenError) {
    return { status: 'error', message: 'You do not have permission to import people.' }
  }
  return { status: 'error', message: fallback }
}

function readMapping(formData: FormData): Record<number, ImportField> | undefined {
  const raw = readString(formData, 'mapping')
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const mapping: Record<number, ImportField> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const index = Number(key)
      if (!Number.isInteger(index) || index < 0) continue
      // Only known field names are accepted, so the mapping cannot be used to
      // reach a column the importer does not intend to support.
      if (typeof value === 'string' && (IMPORT_FIELDS as readonly string[]).includes(value)) {
        mapping[index] = value as ImportField
      }
    }
    return Object.keys(mapping).length > 0 ? mapping : undefined
  } catch {
    return undefined
  }
}

export async function previewImportAction(
  _previous: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const { actor } = await requireActorContext()

  // Either a freshly chosen file, or the text we already hold when the
  // administrator is only adjusting the column mapping.
  const file = formData.get('file')
  const carried = readString(formData, 'csvText')
  let csvText = carried
  let fileName = readString(formData, 'fileName')

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMPORT_BYTES) {
      return {
        status: 'error',
        message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 1 MB, which is about ${MAX_IMPORT_ROWS} rows.`,
      }
    }
    const looksLikeCsv =
      file.name.toLowerCase().endsWith('.csv') ||
      ACCEPTED_MIME_TYPES.includes(file.type) ||
      file.type === ''
    if (!looksLikeCsv) {
      return {
        status: 'error',
        message: `${file.name} does not look like a CSV file. Export your spreadsheet as CSV and try again.`,
      }
    }
    csvText = await file.text()
    fileName = file.name
  }

  if (!csvText) {
    return { status: 'error', message: 'Choose a CSV file to import.' }
  }

  try {
    const preview = await withTenant(actor.organizationId, (tx) =>
      previewImport(tx, actor, csvText, readMapping(formData)),
    )
    return {
      status: 'previewed',
      csvText,
      fileName,
      preview,
      message: preview.fileError ?? undefined,
    }
  } catch (error) {
    return fail(error, 'We could not read that file.')
  }
}

export async function confirmImportAction(
  _previous: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const restricted = demoRestriction()
  if (restricted) return restricted
  const { actor } = await requireActorContext()
  const csvText = readString(formData, 'csvText')
  const sendInvitations = readString(formData, 'sendInvitations') === 'on'

  if (!csvText) return { status: 'error', message: 'Start again by choosing a file.' }

  try {
    const outcome = await withTenant(actor.organizationId, (tx) =>
      runImport(tx, actor, csvText, {
        mapping: readMapping(formData),
        sendInvitations,
        appUrl: getEnv().APP_URL,
      }),
    )

    revalidatePath('/app/people')
    revalidatePath('/app/people/invitations')
    revalidatePath('/app')

    return {
      status: 'imported',
      outcome,
      message:
        `Imported ${outcome.imported} ${outcome.imported === 1 ? 'person' : 'people'}` +
        (outcome.skipped > 0 ? `, skipped ${outcome.skipped} with problems` : '') +
        (outcome.invited > 0 ? `, and sent ${outcome.invited} invitations` : '') +
        '.',
    }
  } catch (error) {
    return fail(error, 'We could not complete that import.')
  }
}
