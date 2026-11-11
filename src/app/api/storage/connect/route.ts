import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../lib/guard'
import type { ParsedConnection } from '../../../../lib/storage/connection'
import { isPrivateHostAllowed, validateConnectionString } from '../../../../lib/storage/connection'
import { StorageError, mapDriverError, safeErrorSummary } from '../../../../lib/storage/errors'
import { workspaceLabel } from '../../../../lib/storage/log'
import { migrateSessionToPostgres } from '../../../../lib/storage/migrate'
import { discardPool, getPool } from '../../../../lib/storage/pg-pool'
import { rejectWidgetTokenHeader, storageErrorResponse } from '../../../../lib/storage/resolve'
import { ensureSchema } from '../../../../lib/storage/schema'
import { secureSetup, tryInstallVector, type SecureSetupResult } from '../../../../lib/storage/secure-setup'
import { isStorageEnabled, sealBuilderToken } from '../../../../lib/storage/token'

export const dynamic = 'force-dynamic'

// A 1,000-character connection string plus a session id fits well inside this.
const MAX_BODY_CHARS = 4096

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text()
    if (text.length > MAX_BODY_CHARS) return null
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  if (isRateLimited(`connect:${clientIp(request)}`, 5)) {
    return storageErrorResponse(new StorageError('rate_limited'))
  }

  const wrongPurpose = rejectWidgetTokenHeader(request)
  if (wrongPurpose) return storageErrorResponse(wrongPurpose)
  if (!isStorageEnabled()) return storageErrorResponse(new StorageError('storage_unavailable'))

  const body = await readBody(request)
  if (!body) return storageErrorResponse(new StorageError('invalid_connection_string'))

  const validated = validateConnectionString(body.connectionString, { allowPrivate: isPrivateHostAllowed() })
  if (!validated.ok) return storageErrorResponse(new StorageError(validated.code))
  const given: ParsedConnection = validated.connection
  let conn: ParsedConnection = given
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null
  // One-click secure setup: opt in per request, so API callers keep today's behaviour.
  const secure = body.secureSetup === true
  let setup: SecureSetupResult | null = null

  try {
    const pool = await getPool(given)
    if (secure) await tryInstallVector(pool)
    await ensureSchema(pool)
    if (secure) {
      setup = await secureSetup(given, isPrivateHostAllowed())
      if (setup.status === 'created') {
        conn = setup.connection
        // The admin login was needed for this request only; keep no pool holding it.
        await discardPool(given)
      }
    }
    const { workspaceId, migratedDocuments, migratedChunks, reopened, existingDocuments, skippedDocuments } =
      await migrateSessionToPostgres(conn, sessionId)
    const token = sealBuilderToken({ conn: conn.normalized, workspaceId })
    console.log(
      `storage connect ok db=${conn.fingerprint} ${workspaceLabel(workspaceId)} docs=${migratedDocuments} chunks=${migratedChunks} setup=${setup?.status ?? 'off'}`,
    )
    const setupOut = setup === null ? undefined
      : setup.status === 'created' ? { status: 'created', role: setup.role }
      : setup.status === 'not_possible' ? { status: 'not_possible', reason: setup.reason }
      : { status: 'already_limited' }
    return NextResponse.json({ status: 'connected', token, migratedDocuments, migratedChunks, reopened, existingDocuments, skippedDocuments, setup: setupOut })
  } catch (e) {
    // A failed connect must not leave a pool behind holding credentials that did not work.
    await discardPool(conn)
    if (conn !== given) await discardPool(given)
    console.error(`storage connect failed db=${conn.fingerprint} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}
