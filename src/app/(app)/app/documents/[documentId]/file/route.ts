import { NextResponse } from 'next/server'
import { requireActorContext } from '@/server/auth/session'
import { withTenant } from '@/server/db'
import { readDocument } from '@/modules/documents/service'
import { NotFoundError } from '@/lib/errors'

/**
 * Serve one document's bytes.
 *
 * Authorization happens here, on every request, not once when the list was
 * rendered: a document marked "managers" is a 404 for anybody else, and a
 * document belonging to another organization does not exist at all - the
 * tenant transaction makes sure of that before this code runs.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params
  const { actor } = await requireActorContext()

  try {
    const document = await withTenant(actor.organizationId, (tx) =>
      readDocument(tx, actor, documentId),
    )
    return new NextResponse(new Uint8Array(document.content), {
      headers: {
        'Content-Type': document.contentType,
        'Content-Length': String(document.byteSize),
        // Shown in the browser where it can be, downloaded otherwise.
        'Content-Disposition': `inline; filename="${document.fileName.replace(/"/g, '')}"`,
        // Personal to the viewer's permissions: never shared by a cache.
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    throw error
  }
}
