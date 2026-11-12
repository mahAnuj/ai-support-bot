import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../lib/guard'
import { CSV_MAX_ROWS, deleteAllTurns, listTurns, turnsToCsv } from '../../../../lib/storage/conversation-log'
import { StorageError, mapDriverError, safeErrorSummary } from '../../../../lib/storage/errors'
import { resolveOwnerDatabase, storageErrorResponse } from '../../../../lib/storage/resolve'

export const dynamic = 'force-dynamic'

// The conversation log, for the owner only (builder token, never a key).
//   GET  ?unmatched=1|low=1&before=<iso>   a page of entries, newest first
//   GET  ?format=csv[&unmatched=1]   every entry kept, as a CSV download
//   DELETE                           delete every entry
export async function GET(request: NextRequest) {
  if (isRateLimited(`storage-log:${clientIp(request)}`, 30)) return storageErrorResponse(new StorageError('rate_limited'))
  const c = resolveOwnerDatabase(request)
  if (!c.ok) return c.res
  const params = request.nextUrl.searchParams
  const unmatchedOnly = params.get('unmatched') === '1'
  const lowMatchOnly = params.get('low') === '1'
  try {
    if (params.get('format') === 'csv') {
      const turns = await listTurns(c.ctx.connection, c.ctx.workspaceId, { unmatchedOnly, lowMatchOnly, limit: CSV_MAX_ROWS })
      return new NextResponse(turnsToCsv(turns), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="conversations-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    const turns = await listTurns(c.ctx.connection, c.ctx.workspaceId, { unmatchedOnly, lowMatchOnly, before: params.get('before') })
    return NextResponse.json({ turns }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error(`conversation log list failed ${c.ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}

export async function DELETE(request: NextRequest) {
  if (isRateLimited(`storage-log-delete:${clientIp(request)}`, 5)) return storageErrorResponse(new StorageError('rate_limited'))
  const c = resolveOwnerDatabase(request)
  if (!c.ok) return c.res
  try {
    return NextResponse.json({ deleted: await deleteAllTurns(c.ctx.connection, c.ctx.workspaceId) })
  } catch (e) {
    console.error(`conversation log delete failed ${c.ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}
