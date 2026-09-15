import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { rateLimited } from '@/server/rate-limit'
import { exportReport } from '@/modules/reports/export'
import { isReportKey } from '@/modules/reports/filters'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * CSV download of one report table. See modules/reports/export.ts for what
 * the file may contain; this handler adds the session, a rate limit, and
 * download headers. Anything the person may not export is a 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ report: string }> }) {
  const { report: key } = await params
  if (!isReportKey(key)) return new Response('Not found', { status: 404 })
  const { actor } = await requireActorContext()
  if (rateLimited('report-export', actor.employmentId, { max: 20, windowMs: 60_000 })) {
    return new Response('Too many exports. Wait a minute and try again.', {
      status: 429,
      headers: { 'Retry-After': '60' },
    })
  }
  const url = new URL(request.url)
  const query = Object.fromEntries(
    (['table', 'location', 'department', 'role', 'from', 'to'] as const).map((k) => [
      k,
      url.searchParams.get(k) ?? undefined,
    ]),
  )
  try {
    const result = await withTenant(actor.organizationId, (tx) =>
      exportReport(tx, actor, key, query),
    )
    return new Response(result.csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError)
      return new Response('Not found', { status: 404 })
    throw error
  }
}
