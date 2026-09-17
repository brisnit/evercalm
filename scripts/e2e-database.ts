/**
 * Create, migrate and mark the browser suite's own database.
 *
 * The browser suite truncates and reseeds on every run, so it gets a database
 * of its own beside the development one in the same local cluster. This script
 * is idempotent: run it as often as you like.
 *
 *   npm run db:e2e:setup
 *
 * It refuses to do anything to a database that is not named evercalm_e2e, and
 * marks the database it creates with COMMENT ON DATABASE so the guard in
 * server/db/e2e-guard.ts can recognise it later. A development database keeps
 * its own marker, which the same guard refuses.
 *
 * Nothing here touches evercalm_dev's data: it only labels it, once, so a
 * misdirected reseed is refused by marker as well as by name.
 */
import { execFileSync } from 'node:child_process'
import pg from 'pg'
import {
  DEVELOPMENT_DATABASE_MARKER,
  E2E_DATABASE_MARKER,
  E2E_DATABASE_NAME,
} from '../src/server/db/e2e-guard'
import { e2eUrls, LOCAL_PG, localUrls } from './local-config'

const admin = `postgres://${LOCAL_PG.superuser}:${LOCAL_PG.superuserPassword}@${LOCAL_PG.host}:${LOCAL_PG.port}/postgres` // secret-scan-allow: throwaway localhost cluster, see scripts/local-postgres.ts

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: admin })
  await client.connect()
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [
      E2E_DATABASE_NAME,
    ])
    if (!rowCount) {
      // The superuser creates it and hands ownership to the migrator, exactly
      // as the development database is created.
      await client.query(`create database ${E2E_DATABASE_NAME} owner ${LOCAL_PG.migratorRole}`)
      console.log(`Created ${E2E_DATABASE_NAME}.`)
    } else {
      console.log(`${E2E_DATABASE_NAME} already exists.`)
    }
    await client.query(`grant connect on database ${E2E_DATABASE_NAME} to ${LOCAL_PG.appRole}`)
    await client.query(`comment on database ${E2E_DATABASE_NAME} is '${E2E_DATABASE_MARKER}'`)
    // Label the development database too, so the guard refuses it by marker
    // and not only by name. A comment changes no data.
    const { rowCount: hasDev } = await client.query(
      'select 1 from pg_database where datname = $1',
      [LOCAL_PG.developmentDatabase],
    )
    if (hasDev) {
      await client.query(
        `comment on database ${LOCAL_PG.developmentDatabase} is '${DEVELOPMENT_DATABASE_MARKER}'`,
      )
    }
  } finally {
    await client.end()
  }

  const urls = e2eUrls()
  execFileSync('npx', ['tsx', 'src/server/db/migrate.ts'], {
    stdio: 'inherit',
    env: { ...process.env, ...urls },
  })
  console.log(`
${E2E_DATABASE_NAME} is ready and marked "${E2E_DATABASE_MARKER}".
Development database ${LOCAL_PG.developmentDatabase} is marked "${DEVELOPMENT_DATABASE_MARKER}" and was not otherwise touched.

Seed it and run the browser suite with:  npm run test:e2e
Its dev server runs on port ${localUrls().E2E_PORT}, separate from your own on 3000.
`)
}

await main()
