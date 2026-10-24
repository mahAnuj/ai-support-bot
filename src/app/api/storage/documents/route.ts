import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../lib/guard'
import { StorageError, mapDriverError, safeErrorSummary } from '../../../../lib/storage/errors'
import { resolveBuilderStore, storageErrorResponse } from '../../../../lib/storage/resolve'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (isRateLimited(`storage-docs:${clientIp(request)}`, 30)) {
    return storageErrorResponse(new StorageError('rate_limited'))
  }

  const resolved = resolveBuilderStore(request)
  if (!resolved.ok) return storageErrorResponse(resolved.error)
  const ctx = resolved.ctx
  // Without a token there is no database to list from.
  if (ctx.kind !== 'postgres') return storageErrorResponse(new StorageError('invalid_token'))

  try {
    const workspace = await ctx.store.getWorkspace(ctx.workspaceId)
    if (!workspace) return storageErrorResponse(new StorageError('workspace_not_found'))
    const docs = await ctx.store.listDocuments(ctx.workspaceId)
    return NextResponse.json({
      status: 'connected',
      documents: docs.map((d) => ({ filename: d.filename, chunks: d.chunkCount })),
    })
  } catch (e) {
    console.error(`storage documents failed ${ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}
