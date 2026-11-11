import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../../lib/guard'
import { getLogSettings, setLogSettings } from '../../../../../lib/storage/conversation-log'
import { StorageError, mapDriverError, safeErrorSummary } from '../../../../../lib/storage/errors'
import { getPool } from '../../../../../lib/storage/pg-pool'
import { resolveOwnerDatabase, storageErrorResponse } from '../../../../../lib/storage/resolve'
import { ensureSchema } from '../../../../../lib/storage/schema'

export const dynamic = 'force-dynamic'

const UNAVAILABLE = {
  error: "This database login can't create the conversation log tables. Run scripts/support-bot-schema.sql and scripts/support-bot-role.sql as an admin, or connect once with your admin login and one-click setup.",
  code: 'insufficient_privilege',
}

// Whether the conversation log is on, and how many days it keeps entries. Owner only.
export async function GET(request: NextRequest) {
  if (isRateLimited(`storage-log-settings:${clientIp(request)}`, 30)) return storageErrorResponse(new StorageError('rate_limited'))
  const c = resolveOwnerDatabase(request)
  if (!c.ok) return c.res
  try {
    await ensureSchema(await getPool(c.ctx.connection))
    return NextResponse.json(await getLogSettings(c.ctx.connection, c.ctx.workspaceId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error(`conversation log settings failed ${c.ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}

export async function PUT(request: NextRequest) {
  if (isRateLimited(`storage-log-settings-put:${clientIp(request)}`, 10)) return storageErrorResponse(new StorageError('rate_limited'))
  const c = resolveOwnerDatabase(request)
  if (!c.ok) return c.res
  let body: { enabled?: unknown; retentionDays?: unknown }
  try {
    const text = await request.text()
    if (text.length > 1024) return NextResponse.json({ error: 'Request too large' }, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 })
  }
  if (typeof body?.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be true or false' }, { status: 400 })
  try {
    await ensureSchema(await getPool(c.ctx.connection))
    const current = await getLogSettings(c.ctx.connection, c.ctx.workspaceId)
    if (!current.available) return NextResponse.json(UNAVAILABLE, { status: 422 })
    const saved = await setLogSettings(c.ctx.connection, c.ctx.workspaceId, body.enabled, body.retentionDays)
    console.log(`conversation log ${saved.enabled ? 'on' : 'off'} days=${saved.retentionDays} ${c.ctx.label}`)
    return NextResponse.json(saved)
  } catch (e) {
    console.error(`conversation log settings update failed ${c.ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}
