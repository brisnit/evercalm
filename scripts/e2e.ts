/**
 * Run the browser suite against its own database and its own dev server.
 *
 * Playwright, the dev server it starts and the reseed in globalSetup all read
 * the same connection strings, so they are set here rather than typed into a
 * shell each time - which is how a test run once reached a developer's own
 * database. Port 3100 and .next-e2e keep this server clear of the one on 3000.
 *
 *   npm run test:e2e                     the whole suite
 *   npm run test:e2e -- training.spec    anything playwright accepts
 *
 * Run npm run db:e2e:setup once first; the guard refuses to start otherwise.
 */
import { spawn } from 'node:child_process'
import { e2eUrls } from './local-config'

const child = spawn('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...e2eUrls(),
    E2E_PORT: '3100',
    NEXT_DIST_DIR: '.next-e2e',
    APP_URL: 'http://localhost:3100',
    E2E_RELAX_RATE_LIMIT: 'true',
  },
})
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
