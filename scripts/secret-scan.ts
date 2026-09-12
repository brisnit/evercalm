/**
 * Secret scan.
 *
 * Scans everything git would actually commit - tracked, staged, and
 * untracked-but-not-ignored files - for credentials. Ignored files are not
 * scanned, because they are not going anywhere.
 *
 * Development credentials that are SUPPOSED to be in the repository (the local
 * throwaway database, the seeded demo password) are allow-listed individually
 * with a stated reason. Anything else is a finding and fails the run.
 *
 * Usage: npm run secrets:scan
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

interface Rule {
  id: string
  description: string
  pattern: RegExp
}

const RULES: Rule[] = [
  {
    id: 'private-key',
    description: 'PEM private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: 'aws-access-key',
    description: 'AWS access key id',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  { id: 'github-token', description: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'slack-token', description: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    id: 'stripe-key',
    description: 'Stripe secret key',
    pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  },
  { id: 'resend-key', description: 'Resend API key', pattern: /\bre_[A-Za-z0-9_]{20,}\b/ },
  { id: 'openai-key', description: 'OpenAI API key', pattern: /\bsk-[A-Za-z0-9]{32,}\b/ },
  {
    id: 'anthropic-key',
    description: 'Anthropic API key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: 'jwt',
    description: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    id: 'assigned-secret',
    description: 'Value assigned to a secret-shaped name',
    pattern:
      /\b(?:SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?TOKEN|PRIVATE_?KEY|CLIENT_?SECRET)\b\s*[:=]\s*['"][^'"\n]{8,}['"]/i,
  },
  {
    id: 'database-url-with-password',
    description: 'Database URL carrying a password',
    pattern: /\bpostgres(?:ql)?:\/\/[^\s:'"]+:[^\s@'"]+@/,
  },
]

/**
 * Inline suppression marker.
 *
 * A line carrying `secret-scan-allow: <reason>`, or immediately preceded by a
 * line carrying it, is skipped. Requiring the justification AT THE SITE beats
 * a central allowlist: the reason sits next to the credential, and adding a
 * new one is visible in the diff that introduces it.
 */
const SUPPRESSION = /secret-scan-allow:\s*(\S.*)$/

/**
 * Development-only values that are intentionally committed. Each entry states
 * why it is safe. Anything not listed here is reported.
 */
const ALLOWED: { value: string; reason: string }[] = [
  { value: 'CHANGE_ME', reason: '.env.example placeholder' },
  { value: 'evercalm_app_dev', reason: 'local throwaway database, localhost only' },
  { value: 'evercalm_migrator_dev', reason: 'local throwaway database, localhost only' },
  { value: 'test_app_pw', reason: 'ephemeral test database, destroyed after each run' },
  { value: 'test_migrator_pw', reason: 'ephemeral test database, destroyed after each run' },
  { value: 'postgres:postgres', reason: 'embedded PostgreSQL bootstrap superuser, localhost only' },
  { value: 'EverCalmDev!2026', reason: 'seeded demo account password, documented in the README' },
  {
    value: 'ci_only_secret_not_used_anywhere_else_0123456789',
    reason: 'CI-only auth secret for a database created and destroyed in the job',
  },
  { value: '<MIGRATOR_PASSWORD>', reason: 'documentation placeholder' },
  { value: '<APP_PASSWORD>', reason: 'documentation placeholder' },
  { value: 'definitely-the-wrong-password', reason: 'browser test fixture' },
  { value: 'password: text(', reason: 'column definition in the auth adapter schema' },
  { value: 'password?: string', reason: 'type signature in the auth configuration' },
]

const SKIP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.pdf',
  '.zip',
])

function filesUnderVersionControl(): string[] {
  // Tracked + staged + untracked-but-not-ignored: exactly what a commit could
  // contain. `--exclude-standard` honours .gitignore.
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return output.split('\n').filter(Boolean)
}

interface Finding {
  file: string
  line: number
  rule: string
  description: string
  excerpt: string
}

interface Suppression {
  file: string
  line: number
  reason: string
}

const suppressions: Suppression[] = []

function isProbablyBinary(contents: string): boolean {
  return contents.includes(String.fromCharCode(0))
}

function scan(files: string[]): Finding[] {
  const findings: Finding[] = []

  for (const relative of files) {
    if (SKIP_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue
    const absolute = path.join(ROOT, relative)

    let contents: string
    try {
      if (statSync(absolute).size > 2 * 1024 * 1024) continue
      contents = readFileSync(absolute, 'utf8')
    } catch {
      continue
    }
    if (isProbablyBinary(contents)) continue

    // The scanner's own rule table is full of credential-shaped patterns.
    if (relative === 'scripts/secret-scan.ts') continue

    const lines = contents.split('\n')
    for (const [index, line] of lines.entries()) {
      if (ALLOWED.some((a) => line.includes(a.value))) continue

      const suppressedHere = SUPPRESSION.exec(line)
      const suppressedAbove = index > 0 ? SUPPRESSION.exec(lines[index - 1] ?? '') : null
      const suppression = suppressedHere ?? suppressedAbove
      if (suppression) {
        suppressions.push({ file: relative, line: index + 1, reason: suppression[1] ?? '' })
        continue
      }

      for (const rule of RULES) {
        if (!rule.pattern.test(line)) continue
        findings.push({
          file: relative,
          line: index + 1,
          rule: rule.id,
          description: rule.description,
          excerpt: line.trim().slice(0, 120),
        })
      }
    }
  }
  return findings
}

const files = filesUnderVersionControl()
const findings = scan(files)
const leakedEnvFiles = files.filter((f) => /(^|\/)\.env/.test(f) && !f.endsWith('.env.example'))

console.log(`Scanned ${files.length} files that git would commit.`)
console.log(`Allow-listed development credentials: ${ALLOWED.length}`)
if (suppressions.length > 0) {
  console.log(`\nInline suppressions (${suppressions.length}), each with a stated reason:`)
  for (const s of suppressions) console.log(`  ${s.file}:${s.line}  ${s.reason}`)
}

if (leakedEnvFiles.length > 0) {
  console.error('\nEnvironment files are not ignored:')
  for (const f of leakedEnvFiles) console.error(`  ${f}`)
}

if (findings.length === 0 && leakedEnvFiles.length === 0) {
  console.log('\nNo secrets found.')
} else {
  console.error(`\n${findings.length} finding(s):`)
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.description}`)
    console.error(`    ${f.excerpt}`)
  }
  await new Promise<void>((resolve) => {
    process.stderr.write('', () => resolve())
  })
  process.exit(1)
}
