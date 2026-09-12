/**
 * A guard for CLI tools that must never touch a real database.
 *
 * Two of them are dangerous in different ways: the seed creates accounts whose
 * password is a published constant, and the refresh TRUNCATES every table.
 * Both are safe on a laptop and catastrophic against production, and the only
 * thing standing between the two is which connection string happens to be in
 * the environment.
 *
 * So the check is not advisory. It refuses on NODE_ENV, and it refuses on any
 * host that is not loopback, because a staging URL pasted in for five minutes
 * is exactly how these accidents happen.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

export function assertDevelopmentDatabase(operation: string, url: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Refusing to ${operation}: NODE_ENV is production.`)
  }

  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(`Refusing to ${operation}: the database URL could not be parsed.`)
  }

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to ${operation}: ${host} is not a local database. ` +
        `This tool is for development only. If you genuinely mean to run it ` +
        `against ${host}, do it deliberately and by hand.`,
    )
  }
}
