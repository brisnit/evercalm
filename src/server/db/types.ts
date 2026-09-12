import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { NodePgDatabase, NodePgTransaction } from 'drizzle-orm/node-postgres'
import type * as fullSchema from './full-schema'

export type FullSchema = typeof fullSchema
export type Db = NodePgDatabase<FullSchema>
export type Tx = NodePgTransaction<FullSchema, ExtractTablesWithRelations<FullSchema>>
