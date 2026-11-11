// Server-only: automation keys for one workspace.
//
// The key an owner copies is an sbk1_ token (src/lib/storage/token.ts): sealed
// like every other token, it carries the connection string, the workspace and
// a key id, because this server stores no connection strings anywhere. The
// support_bot.api_keys row is what makes a key revocable and auditable: a key
// works only while its row exists in that workspace with no revoked_at.
import { randomUUID } from 'node:crypto'
import type { ParsedConnection } from './connection'
import { mapDriverError } from './errors'
import { getPool } from './pg-pool'
import { sealAutomationKey } from './token'

export const MAX_KEY_LABEL = 80
export const MAX_ACTIVE_KEYS = 10

export interface AutomationKeySummary {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
  revoked: boolean
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SQL_COUNT_ACTIVE = 'SELECT count(*)::int AS n FROM support_bot.api_keys WHERE workspace_id = $1 AND revoked_at IS NULL'
const SQL_INSERT = 'INSERT INTO support_bot.api_keys (id, workspace_id, label) VALUES ($1, $2, $3)'
const SQL_LIST =
  'SELECT id, label, created_at, last_used_at, revoked_at FROM support_bot.api_keys WHERE workspace_id = $1 ORDER BY created_at DESC, id'
const SQL_REVOKE =
  'UPDATE support_bot.api_keys SET revoked_at = now() WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL'
// Checks and records use in one statement: only an active key in this
// workspace matches, so a revoked or foreign key updates nothing.
const SQL_USE =
  'UPDATE support_bot.api_keys SET last_used_at = now() WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL RETURNING id'

export function normalizeKeyLabel(label: unknown): string {
  const text = typeof label === 'string' ? label.replace(/\s+/g, ' ').trim().slice(0, MAX_KEY_LABEL) : ''
  return text || 'Automation key'
}

async function run<T extends Record<string, unknown>>(connection: ParsedConnection, sql: string, params: unknown[]) {
  try {
    const pool = await getPool(connection)
    return await pool.query<T>(sql, params)
  } catch (err) {
    throw mapDriverError(err)
  }
}

export async function createAutomationKey(
  connection: ParsedConnection,
  workspaceId: string,
  label: unknown,
): Promise<{ key: string; summary: AutomationKeySummary } | 'too_many'> {
  const active = await run<{ n: number }>(connection, SQL_COUNT_ACTIVE, [workspaceId])
  if ((active.rows[0]?.n ?? 0) >= MAX_ACTIVE_KEYS) return 'too_many'
  const id = randomUUID()
  const name = normalizeKeyLabel(label)
  await run(connection, SQL_INSERT, [id, workspaceId, name])
  const key = sealAutomationKey({ conn: connection.normalized, workspaceId, keyId: id })
  return { key, summary: { id, label: name, createdAt: new Date().toISOString(), lastUsedAt: null, revoked: false } }
}

export async function listAutomationKeys(connection: ParsedConnection, workspaceId: string): Promise<AutomationKeySummary[]> {
  const result = await run<{ id: string; label: string; created_at: Date; last_used_at: Date | null; revoked_at: Date | null }>(
    connection,
    SQL_LIST,
    [workspaceId],
  )
  return result.rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
    revoked: r.revoked_at !== null,
  }))
}

export async function revokeAutomationKey(connection: ParsedConnection, workspaceId: string, keyId: unknown): Promise<boolean> {
  if (typeof keyId !== 'string' || !UUID_PATTERN.test(keyId)) return false
  const result = await run(connection, SQL_REVOKE, [keyId, workspaceId])
  return (result.rowCount ?? 0) > 0
}

// True only for an active key of this workspace; records the use.
export async function checkAutomationKey(connection: ParsedConnection, workspaceId: string, keyId: string): Promise<boolean> {
  const result = await run(connection, SQL_USE, [keyId, workspaceId])
  return (result.rowCount ?? 0) > 0
}
