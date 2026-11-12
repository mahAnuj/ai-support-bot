import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../lib/guard'
import { readDailyStats, setStatsEnabled } from '../../../../lib/storage/daily-stats'
import { StorageError, mapDriverError, safeErrorSummary } from '../../../../lib/storage/errors'
import { getPool } from '../../../../lib/storage/pg-pool'
import { resolveOwnerDatabase, storageErrorResponse } from '../../../../lib/storage/resolve'
import { ensureSchema } from '../../../../lib/storage/schema'

export const dynamic = 'force-dynamic'

// Daily counts for the analytics panel. Owner only (builder token, never a key).
//   GET ?days=30      the last 7-365 days, a row per day, plus totals
//   PUT {enabled}     turn counting on or off
export async function GET(request: NextRequest) {
  if (isRateLimited(`storage-stats:${clientIp(request)}`, 30)) return storageErrorResponse(new StorageError('rate_limited'))
  const c = resolveOwnerDatabase(request)
  if (!c.ok) return c.res
  try {
    await ensureSchema(await getPool(c.ctx.connection))
    const report = await readDailyStats(c.ctx.connection, c.ctx.workspaceId, request.nextUrl.searchParams.get('days'))
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error(`stats read failed ${c.ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}

export async function PUT(request: NextRequest) {
  if (isRateLimited(`storage-stats-put:${clientIp(request)}`, 10)) return storageErrorResponse(new StorageError('rate_limited'))
  const c = resolveOwnerDatabase(request)
  if (!c.ok) return c.res
  let enabled: unknown
  try {
    enabled = JSON.parse(await request.text())?.enabled
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 })
  }
  if (typeof enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be true or false' }, { status: 400 })
  try {
    await ensureSchema(await getPool(c.ctx.connection))
    await setStatsEnabled(c.ctx.connection, c.ctx.workspaceId, enabled)
    return NextResponse.json({ enabled })
  } catch (e) {
    if ((e as { code?: unknown })?.code === '42703') {
      return NextResponse.json({
        error: 'The settings table needs one more column. As an admin, run: ALTER TABLE support_bot.log_settings ADD COLUMN IF NOT EXISTS stats_enabled boolean NOT NULL DEFAULT true;',
        code: 'insufficient_privilege',
      }, { status: 422 })
    }
    console.error(`stats setting failed ${c.ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}
