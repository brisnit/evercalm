import { appPool } from './client'

/**
 * WHICH ORGANIZATIONS HAVE BACKGROUND WORK DUE.
 *
 * The worker's only cross-tenant question, answered by the SECURITY DEFINER
 * function in migration 0013. It returns organization ids and nothing else;
 * the work itself then runs inside withTenant(), under RLS, per organization.
 *
 * Lives in the database layer - the one place allowed to use the pool without
 * a tenant context - rather than carving an exception into the lint rule for
 * the worker.
 */
export async function organizationsWithDueWork(now: Date): Promise<string[]> {
  const result = await appPool().query<{ organization_id: string }>(
    'select organization_id from evercalm_organizations_with_due_work($1)',
    [now],
  )
  return result.rows.map((row) => row.organization_id)
}
