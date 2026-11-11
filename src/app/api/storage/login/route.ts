import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../lib/guard'
import { StorageError, mapDriverError, safeErrorSummary } from '../../../../lib/storage/errors'
import { getPool } from '../../../../lib/storage/pg-pool'
import { builderErrorResponse, resolveBuilderStore, storageErrorResponse } from '../../../../lib/storage/resolve'

export const dynamic = 'force-dynamic'

// Which database login this browser's link uses, and whether it is an admin
// login (superuser, or allowed to create logins). The builder shows it, because
// embed code and automation keys carry that login: an owner who connected as
// neondb_owner should know before generating either. The user name only;
// never the password or anything else from the connection string.
export async function GET(request: NextRequest) {
  if (isRateLimited(`storage-login:${clientIp(request)}`, 30)) return storageErrorResponse(new StorageError('rate_limited'))
  if (request.headers.get('authorization') !== null) return storageErrorResponse(new StorageError('token_wrong_purpose'))
  const resolved = resolveBuilderStore(request)
  if (!resolved.ok) return builderErrorResponse(resolved.error)
  if (resolved.ctx.kind !== 'postgres') return storageErrorResponse(new StorageError('token_wrong_purpose'))
  const { connection, label } = resolved.ctx
  try {
    const pool = await getPool(connection)
    const r = await pool.query<{ user: string; admin: boolean }>(
      'SELECT current_user AS user, (rolsuper OR rolcreaterole) AS admin FROM pg_roles WHERE rolname = current_user',
    )
    const row = r.rows[0]
    return NextResponse.json({ user: row?.user ?? connection.user, admin: row?.admin === true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error(`storage login check failed ${label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}
