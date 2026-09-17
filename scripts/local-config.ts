/**
 * The local cluster's fixed facts, in one place.
 *
 * The development database and the browser suite's database live in the same
 * local cluster with the same two roles. These values are the throwaway local
 * ones created by scripts/local-postgres.ts; nothing here is a secret and
 * nothing here is ever used against a hosted database.
 */
import { E2E_DATABASE_NAME } from '../src/server/db/e2e-guard'

export const LOCAL_PG = {
  host: '127.0.0.1',
  port: Number(process.env.LOCAL_PG_PORT ?? 55_500),
  superuser: 'postgres',
  superuserPassword: 'postgres', // secret-scan-allow: bootstrap superuser of a throwaway localhost cluster
  appRole: 'evercalm_app',
  appPassword: 'evercalm_app_dev', // secret-scan-allow: local development role, localhost only
  migratorRole: 'evercalm_migrator',
  migratorPassword: 'evercalm_migrator_dev', // secret-scan-allow: local development role, localhost only
  developmentDatabase: 'evercalm_dev',
} as const

function urlsFor(database: string) {
  const at = `@${LOCAL_PG.host}:${LOCAL_PG.port}/${database}`
  return {
    DATABASE_URL: `postgres://${LOCAL_PG.appRole}:${LOCAL_PG.appPassword}${at}`,
    MIGRATION_DATABASE_URL: `postgres://${LOCAL_PG.migratorRole}:${LOCAL_PG.migratorPassword}${at}`,
  }
}

/** The browser suite's database, on its own port and build directory. */
export function e2eUrls() {
  return urlsFor(E2E_DATABASE_NAME)
}

export function localUrls() {
  return {
    ...urlsFor(LOCAL_PG.developmentDatabase),
    E2E_PORT: '3100',
  }
}
