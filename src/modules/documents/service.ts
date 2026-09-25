import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import {
  documents,
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
  type DocumentVisibility,
} from './schema'
import { employments, locations } from '@/server/db/schema'
import type { Tx } from '@/server/db'
import type { Actor } from '@/server/authz/actor'
import { newId } from '@/lib/ids'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { canAtAnyLocation } from '@/server/authz/can'
import { AUDIT_ACTIONS, recordAuditEvent } from '@/server/audit'

// The category list and its labels belong together, and a page talks to a
// service rather than reaching into another module's schema.
export { DOCUMENT_CATEGORIES }
export type { DocumentCategory, DocumentVisibility }

/**
 * THE DOCUMENT HUB.
 *
 * Who may do what:
 *
 *   upload, replace, remove   announcement.create - the same people who can
 *                             tell the whole company something. A document is
 *                             the durable version of that.
 *   read                      everybody, for a document marked "everyone";
 *                             people.view - which is what every manager role
 *                             holds and no employee does - for one marked
 *                             "managers".
 *
 * Nothing is ever hard-deleted: removing a document archives it, so a record
 * of what people were told still exists. The bytes go when the row does.
 */

export const MAX_BYTES = 8 * 1024 * 1024

/** What a browser will open rather than mangle. */
const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
  'text/plain': 'Text',
  'text/csv': 'CSV',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Spreadsheet',
}

export function fileKindLabel(contentType: string): string {
  return ALLOWED_TYPES[contentType] ?? 'File'
}

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  policy: 'Policy',
  safety: 'Safety',
  training: 'Training',
  operations: 'Operations',
  legal: 'Legal',
  other: 'Other',
}

/**
 * "Managers only" means the people who can already speak for the business.
 *
 * Deliberately narrower than "can see the directory": a shift lead is a
 * keyholder, not a manager, and these documents hold things like the safe
 * policy. The same rule governs a managers-only channel, so the two surfaces
 * never disagree about who is in the room.
 */
function isManager(actor: Actor): boolean {
  return canAtAnyLocation(actor, 'announcement.create')
}

function canManage(actor: Actor): boolean {
  return canAtAnyLocation(actor, 'announcement.create')
}

export interface DocumentSummary {
  id: string
  title: string
  description: string
  category: DocumentCategory
  visibility: DocumentVisibility
  fileName: string
  contentType: string
  byteSize: number
  locationId: string | null
  locationName: string | null
  uploadedBy: string | null
  createdAt: Date
}

export async function listDocuments(tx: Tx, actor: Actor): Promise<DocumentSummary[]> {
  const rows = await tx
    .select({
      id: documents.id,
      title: documents.title,
      description: documents.description,
      category: documents.category,
      visibility: documents.visibility,
      fileName: documents.fileName,
      contentType: documents.contentType,
      byteSize: documents.byteSize,
      locationId: documents.locationId,
      locationName: locations.name,
      uploadedBy: employments.displayName,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .leftJoin(
      locations,
      and(
        eq(locations.organizationId, documents.organizationId),
        eq(locations.id, documents.locationId),
      ),
    )
    .leftJoin(
      employments,
      and(
        eq(employments.organizationId, documents.organizationId),
        eq(employments.id, documents.uploadedByEmploymentId),
      ),
    )
    .where(and(eq(documents.organizationId, actor.organizationId), isNull(documents.archivedAt)))
    .orderBy(asc(documents.category), desc(documents.createdAt))

  return rows
    .filter((row) => row.visibility === 'everyone' || isManager(actor))
    .map((row) => ({
      ...row,
      category: row.category as DocumentCategory,
      visibility: row.visibility as DocumentVisibility,
    }))
}

/** The bytes, for the route that serves them. Authorizes on every request. */
export async function readDocument(tx: Tx, actor: Actor, documentId: string) {
  const [row] = await tx
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, actor.organizationId),
        eq(documents.id, documentId),
        isNull(documents.archivedAt),
      ),
    )
    .limit(1)
  if (!row) throw new NotFoundError('Document not found')
  if (row.visibility === 'managers' && !isManager(actor)) {
    // Not for them: indistinguishable from one that is not there.
    throw new NotFoundError('Document not found')
  }
  return row
}

export interface UploadInput {
  title: string
  description: string
  category: string
  visibility: string
  locationId: string | null
  fileName: string
  contentType: string
  bytes: Buffer
}

export async function uploadDocument(tx: Tx, actor: Actor, input: UploadInput): Promise<string> {
  if (!canManage(actor)) throw new ForbiddenError('You cannot add documents')

  const title = input.title.trim()
  if (!title) throw new ValidationError({ title: ['Give the document a name'] })
  if (title.length > 160) throw new ValidationError({ title: ['That name is too long'] })
  if (input.bytes.byteLength === 0) throw new ValidationError({ file: ['Choose a file'] })
  if (input.bytes.byteLength > MAX_BYTES) {
    throw new ValidationError({
      file: [`That file is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`],
    })
  }
  if (!ALLOWED_TYPES[input.contentType]) {
    throw new ValidationError({
      file: [
        'That kind of file is not accepted. Use a PDF, image, text, Word or spreadsheet file.',
      ],
    })
  }
  const category = (DOCUMENT_CATEGORIES as readonly string[]).includes(input.category)
    ? input.category
    : 'other'
  const visibility = input.visibility === 'managers' ? 'managers' : 'everyone'

  const id = newId()
  await tx.insert(documents).values({
    id,
    organizationId: actor.organizationId,
    locationId: input.locationId,
    title,
    description: input.description.trim().slice(0, 400),
    category,
    visibility,
    fileName: input.fileName.slice(0, 200),
    contentType: input.contentType,
    byteSize: input.bytes.byteLength,
    content: input.bytes,
    uploadedByEmploymentId: actor.employmentId,
  })

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.DOCUMENT_ADDED,
    summary: `Added the document "${title}"`,
    subjectType: 'document',
    subjectId: id,
    locationId: input.locationId ?? undefined,
    metadata: { category, visibility, bytes: input.bytes.byteLength },
  })

  return id
}

export async function archiveDocument(tx: Tx, actor: Actor, documentId: string): Promise<void> {
  if (!canManage(actor)) throw new ForbiddenError('You cannot remove documents')
  const [row] = await tx
    .select({ title: documents.title })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, actor.organizationId),
        eq(documents.id, documentId),
        isNull(documents.archivedAt),
      ),
    )
    .limit(1)
  if (!row) throw new NotFoundError('Document not found')

  await tx
    .update(documents)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(documents.organizationId, actor.organizationId), eq(documents.id, documentId)))

  await recordAuditEvent(tx, actor, {
    action: AUDIT_ACTIONS.DOCUMENT_REMOVED,
    summary: `Removed the document "${row.title}"`,
    subjectType: 'document',
    subjectId: documentId,
  })
}
