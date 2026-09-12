import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit generates DDL only. Row-Level Security policies, database
 * roles, and grants are hand-written SQL migrations, because they are the
 * security boundary and must be reviewable as SQL.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/full-schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
})
