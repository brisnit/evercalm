/**
 * Every table, tenant and identity alike.
 *
 * Used ONLY for wiring that must see the whole database:
 *   - the Drizzle client's type parameter
 *   - drizzle-kit migration generation
 *   - the seed, which creates identity rows alongside tenant rows
 *   - the RLS coverage test, which must account for every table
 *
 * Application and module code imports ./schema instead.
 */
export * from './schema'
export * from './identity-schema'
export * from './platform-schema'
