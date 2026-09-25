import { sql } from 'drizzle-orm'
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { locations, organizations } from '@/modules/org/schema'
import { employments } from '@/modules/people/schema'

/**
 * THE DOCUMENT HUB.
 *
 * The handbook, the allergen matrix, the lease, the cleaning schedule: the
 * things an operator is asked for and cannot find. One list, with who it is
 * for and where it applies.
 *
 * WHERE THE BYTES LIVE. In this build the file itself is stored in the tenant
 * database and served through a route that authorizes every request, so the
 * hub genuinely uploads, opens and deletes rather than pretending to. That is
 * a deliberate, bounded choice - there is a hard size cap - and it is the
 * first thing to move: production belongs on object storage with short-lived
 * signed URLs, which is written down in the deferred list rather than implied.
 */

/** Postgres bytea, as a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

export const DOCUMENT_VISIBILITIES = ['everyone', 'managers'] as const
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number]

export const DOCUMENT_CATEGORIES = [
  'policy',
  'safety',
  'training',
  'operations',
  'legal',
  'other',
] as const
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number]

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Null means it applies to the whole organization. */
    locationId: uuid('location_id'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull().default('other'),
    visibility: text('visibility').notNull().default('everyone'),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    content: bytea('content').notNull(),
    uploadedByEmploymentId: uuid('uploaded_by_employment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    unique('documents_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      columns: [t.organizationId, t.locationId],
      foreignColumns: [locations.organizationId, locations.id],
      name: 'documents_location_tenant_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.organizationId, t.uploadedByEmploymentId],
      foreignColumns: [employments.organizationId, employments.id],
      name: 'documents_uploader_tenant_fk',
    }),
    check('documents_visibility_check', sql`${t.visibility} in ('everyone', 'managers')`),
    check(
      'documents_category_check',
      sql`${t.category} in ('policy','safety','training','operations','legal','other')`,
    ),
    check('documents_size_check', sql`${t.byteSize} > 0 and ${t.byteSize} <= 8388608`),
    index('documents_org_idx').on(t.organizationId, t.archivedAt),
  ],
)
