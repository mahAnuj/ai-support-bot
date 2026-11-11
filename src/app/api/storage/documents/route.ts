import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../lib/guard'
import { StorageError, mapDriverError, safeErrorSummary } from '../../../../lib/storage/errors'
import { builderErrorResponse, resolveDocumentAccess, storageErrorResponse } from '../../../../lib/storage/resolve'
import { recordKeyEvent } from '../../../../lib/storage/api-keys'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (isRateLimited(`storage-docs:${clientIp(request)}`, 30)) {
    return storageErrorResponse(new StorageError('rate_limited'))
  }

  const resolved = await resolveDocumentAccess(request)
  if (!resolved.ok) return builderErrorResponse(resolved.error)
  const ctx = resolved.ctx
  // A backend's documents are listed by /api/connector/documents.
  if (ctx.kind === 'connector') return storageErrorResponse(new StorageError('token_wrong_purpose'))
  // Without a token there is no database to list from.
  if (ctx.kind !== 'postgres') return storageErrorResponse(new StorageError('invalid_token'))

  try {
    const workspace = await ctx.store.getWorkspace(ctx.workspaceId)
    if (!workspace) return storageErrorResponse(new StorageError('workspace_not_found'))
    const docs = await ctx.store.listDocuments(ctx.workspaceId)
    return NextResponse.json({
      status: 'connected',
      documents: docs.map((d) => ({ id: d.id, filename: d.filename, chunks: d.chunkCount })),
    })
  } catch (e) {
    console.error(`storage documents failed ${ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}

// Remove one document (and its chunks) from the token's workspace. The
// database login needs DELETE on the support_bot tables; without it this
// returns insufficient_privilege.
export async function DELETE(request: NextRequest) {
  if (isRateLimited(`storage-docs-delete:${clientIp(request)}`, 30)) {
    return storageErrorResponse(new StorageError('rate_limited'))
  }
  const resolved = await resolveDocumentAccess(request)
  if (!resolved.ok) return builderErrorResponse(resolved.error)
  const ctx = resolved.ctx
  if (ctx.kind === 'connector') return storageErrorResponse(new StorageError('token_wrong_purpose'))
  if (ctx.kind !== 'postgres') return storageErrorResponse(new StorageError('invalid_token'))

  const id = request.nextUrl.searchParams.get('id') ?? ''
  try {
    // The filename is read first so the audit trail can name what was removed.
    const filename = resolved.keyId ? (await ctx.store.listDocuments(ctx.workspaceId)).find((d) => d.id === id)?.filename ?? null : null
    const removed = await ctx.store.deleteDocument(ctx.workspaceId, id)
    if (!removed) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    let audit = true
    if (resolved.keyId) audit = await recordKeyEvent(ctx.connection, ctx.workspaceId, resolved.keyId, 'removed', filename)
    return NextResponse.json({ status: 'deleted', ...(audit ? {} : { audit: 'not_recorded' }) })
  } catch (e) {
    console.error(`storage document delete failed ${ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}
