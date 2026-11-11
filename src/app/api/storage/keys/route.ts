import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../lib/guard'
import {
  MAX_ACTIVE_KEYS,
  createAutomationKey,
  listAutomationKeys,
  revokeAutomationKey,
} from '../../../../lib/storage/api-keys'
import { StorageError, mapDriverError, safeErrorSummary } from '../../../../lib/storage/errors'
import { getPool } from '../../../../lib/storage/pg-pool'
import { builderErrorResponse, resolveBuilderStore, storageErrorResponse, type BuilderContext } from '../../../../lib/storage/resolve'
import { ensureSchema } from '../../../../lib/storage/schema'

export const dynamic = 'force-dynamic'

// Managing automation keys needs the owner's builder token (the browser that
// connected the database), never a key: a leaked key must not be able to mint
// or revoke keys. Only databases have keys; a backend or the demo does not.
function postgresContext(request: NextRequest): { ok: true; ctx: Extract<BuilderContext, { kind: 'postgres' }> } | { ok: false; res: NextResponse } {
  if (request.headers.get('authorization') !== null) {
    return { ok: false, res: storageErrorResponse(new StorageError('token_wrong_purpose')) }
  }
  const resolved = resolveBuilderStore(request)
  if (!resolved.ok) return { ok: false, res: builderErrorResponse(resolved.error) }
  if (resolved.ctx.kind !== 'postgres') {
    return { ok: false, res: storageErrorResponse(new StorageError(resolved.ctx.kind === 'connector' ? 'token_wrong_purpose' : 'invalid_token')) }
  }
  return { ok: true, ctx: resolved.ctx }
}

export async function GET(request: NextRequest) {
  if (isRateLimited(`storage-keys:${clientIp(request)}`, 30)) return storageErrorResponse(new StorageError('rate_limited'))
  const c = postgresContext(request)
  if (!c.ok) return c.res
  try {
    await ensureSchema(await getPool(c.ctx.connection))
    return NextResponse.json(
      { keys: await listAutomationKeys(c.ctx.connection, c.ctx.workspaceId) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    console.error(`storage keys list failed ${c.ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}

export async function POST(request: NextRequest) {
  if (isRateLimited(`storage-keys-create:${clientIp(request)}`, 5)) return storageErrorResponse(new StorageError('rate_limited'))
  const c = postgresContext(request)
  if (!c.ok) return c.res
  let label: unknown = ''
  try {
    const text = await request.text()
    if (text.length > 2048) return NextResponse.json({ error: 'Request too large' }, { status: 413 })
    label = text ? (JSON.parse(text) as { label?: unknown }).label : ''
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 })
  }
  try {
    // Databases connected before keys existed gain the api_keys table here.
    await ensureSchema(await getPool(c.ctx.connection))
    const created = await createAutomationKey(c.ctx.connection, c.ctx.workspaceId, label)
    if (created === 'too_many') {
      return NextResponse.json(
        { error: `This workspace already has ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`, code: 'too_many_keys' },
        { status: 409 },
      )
    }
    console.log(`storage key created ${c.ctx.label}`)
    // The key is returned once and never again: it is not stored anywhere.
    return NextResponse.json({ key: created.key, summary: created.summary }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error(`storage key create failed ${c.ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}

export async function DELETE(request: NextRequest) {
  if (isRateLimited(`storage-keys:${clientIp(request)}`, 30)) return storageErrorResponse(new StorageError('rate_limited'))
  const c = postgresContext(request)
  if (!c.ok) return c.res
  try {
    const revoked = await revokeAutomationKey(c.ctx.connection, c.ctx.workspaceId, request.nextUrl.searchParams.get('id'))
    if (!revoked) return NextResponse.json({ error: 'Key not found or already revoked' }, { status: 404 })
    console.log(`storage key revoked ${c.ctx.label}`)
    return NextResponse.json({ status: 'revoked' })
  } catch (e) {
    console.error(`storage key revoke failed ${c.ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}
