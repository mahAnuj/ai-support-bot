// Server-only: automation keys for one workspace, with expiry and an audit trail.
//
// The key an owner copies is an sbk1_ token (src/lib/storage/token.ts): sealed
// like every other token, it carries the connection string, the workspace and
// a key id, because this server stores no connection strings anywhere. The
// support_bot.api_keys row makes a key revocable and expirable, and
// support_bot.key_events records what each key did. Both tables live in the
// owner's database, next to the documents.
import { randomUUID } from 'node:crypto'
import type { ParsedConnection } from './connection'
import { mapDriverError } from './errors'
import { getPool } from './pg-pool'
import { sealAutomationKey } from './token'

export const MAX_KEY_LABEL = 80
export const MAX_ACTIVE_KEYS = 10
// Days a new key lasts; null is "never". A forgotten key should die eventually,
// so the builder defaults to a year.
export const KEY_LIFETIMES = [30, 90, 365, null] as const
export type KeyLifetime = (typeof KEY_LIFETIMES)[number]
export const DEFAULT_KEY_LIFETIME: KeyLifetime = 365
const RECENT_EVENTS_PER_KEY = 5

export type KeyAction = 'uploaded' | 'replaced' | 'removed' | 'refused'

export interface KeyEvent { action: KeyAction; filename: string | null; detail: string | null; at: string }

export interface AutomationKeySummary {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  expired: boolean
  revoked: boolean
  recent: KeyEvent[]
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SQL_COUNT_ACTIVE =
  'SELECT count(*)::int AS n FROM support_bot.api_keys WHERE workspace_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())'
const SQL_INSERT =
  "INSERT INTO support_bot.api_keys (id, workspace_id, label, expires_at) VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + make_interval(days => $4::int) END) RETURNING created_at, expires_at"
const SQL_LIST =
  'SELECT id, label, created_at, last_used_at, revoked_at, expires_at, (expires_at IS NOT NULL AND expires_at <= now()) AS expired FROM support_bot.api_keys WHERE workspace_id = $1 ORDER BY created_at DESC, id'
const SQL_RECENT =
  'SELECT key_id, action, filename, detail, at FROM (SELECT e.*, row_number() OVER (PARTITION BY key_id ORDER BY at DESC) AS rn FROM support_bot.key_events e WHERE workspace_id = $1) t WHERE rn <= $2 ORDER BY at DESC'
const SQL_REVOKE =
  'UPDATE support_bot.api_keys SET revoked_at = now() WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL'
// Checks and records use in one statement: only an active, unexpired key in
// this workspace matches, so anything else updates nothing.
const SQL_USE =
  'UPDATE support_bot.api_keys SET last_used_at = now() WHERE id = $1 AND workspace_id = $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) RETURNING id'
const SQL_STATE =
  'SELECT revoked_at IS NOT NULL AS revoked, (expires_at IS NOT NULL AND expires_at <= now()) AS expired FROM support_bot.api_keys WHERE id = $1 AND workspace_id = $2'
const SQL_EVENT =
  'INSERT INTO support_bot.key_events (id, key_id, workspace_id, action, filename, detail) VALUES ($1, $2, $3, $4, $5, $6)'

export function normalizeKeyLabel(label: unknown): string {
  const text = typeof label === 'string' ? label.replace(/\s+/g, ' ').trim().slice(0, MAX_KEY_LABEL) : ''
  return text || 'Automation key'
}

export function normalizeLifetime(value: unknown): KeyLifetime {
  if (value === null || value === 'never') return null
  const n = typeof value === 'string' ? Number(value) : value
  return (KEY_LIFETIMES as readonly unknown[]).includes(n) ? (n as KeyLifetime) : DEFAULT_KEY_LIFETIME
}

async function run<T extends Record<string, unknown>>(connection: ParsedConnection, sql: string, params: unknown[]) {
  try {
    const pool = await getPool(connection)
    return await pool.query<T>(sql, params)
  } catch (err) {
    throw mapDriverError(err)
  }
}

const iso = (d: Date | null) => (d ? d.toISOString() : null)

export async function createAutomationKey(
  connection: ParsedConnection,
  workspaceId: string,
  label: unknown,
  lifetime: unknown = DEFAULT_KEY_LIFETIME,
): Promise<{ key: string; summary: AutomationKeySummary } | 'too_many'> {
  const active = await run<{ n: number }>(connection, SQL_COUNT_ACTIVE, [workspaceId])
  if ((active.rows[0]?.n ?? 0) >= MAX_ACTIVE_KEYS) return 'too_many'
  const id = randomUUID()
  const name = normalizeKeyLabel(label)
  const days = normalizeLifetime(lifetime)
  const row = (await run<{ created_at: Date; expires_at: Date | null }>(connection, SQL_INSERT, [id, workspaceId, name, days])).rows[0]
  const key = sealAutomationKey({ conn: connection.normalized, workspaceId, keyId: id })
  return {
    key,
    summary: { id, label: name, createdAt: iso(row.created_at)!, lastUsedAt: null, expiresAt: iso(row.expires_at), expired: false, revoked: false, recent: [] },
  }
}

export async function listAutomationKeys(connection: ParsedConnection, workspaceId: string): Promise<AutomationKeySummary[]> {
  const keys = await run<{ id: string; label: string; created_at: Date; last_used_at: Date | null; revoked_at: Date | null; expires_at: Date | null; expired: boolean }>(
    connection, SQL_LIST, [workspaceId],
  )
  const events = await run<{ key_id: string; action: KeyAction; filename: string | null; detail: string | null; at: Date }>(
    connection, SQL_RECENT, [workspaceId, RECENT_EVENTS_PER_KEY],
  )
  const byKey = new Map<string, KeyEvent[]>()
  for (const e of events.rows) {
    const list = byKey.get(e.key_id) ?? []
    list.push({ action: e.action, filename: e.filename, detail: e.detail, at: e.at.toISOString() })
    byKey.set(e.key_id, list)
  }
  return keys.rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: iso(r.last_used_at),
    expiresAt: iso(r.expires_at),
    expired: r.expired,
    revoked: r.revoked_at !== null,
    recent: byKey.get(r.id) ?? [],
  }))
}

export async function revokeAutomationKey(connection: ParsedConnection, workspaceId: string, keyId: unknown): Promise<boolean> {
  if (typeof keyId !== 'string' || !UUID_PATTERN.test(keyId)) return false
  const result = await run(connection, SQL_REVOKE, [keyId, workspaceId])
  return (result.rowCount ?? 0) > 0
}

// 'ok' for an active key of this workspace (and records the use); otherwise
// why not. 'unknown' means no such key in this workspace.
export async function checkAutomationKey(
  connection: ParsedConnection,
  workspaceId: string,
  keyId: string,
): Promise<'ok' | 'revoked' | 'expired' | 'unknown'> {
  const used = await run(connection, SQL_USE, [keyId, workspaceId])
  if ((used.rowCount ?? 0) > 0) return 'ok'
  const state = (await run<{ revoked: boolean; expired: boolean }>(connection, SQL_STATE, [keyId, workspaceId])).rows[0]
  if (!state) return 'unknown'
  return state.revoked ? 'revoked' : 'expired'
}

// Best effort by design: an audit write that fails is logged on the server
// and reported to the caller, but never undoes the document change it
// describes. Callers pass only filenames, never content.
export async function recordKeyEvent(
  connection: ParsedConnection,
  workspaceId: string,
  keyId: string,
  action: KeyAction,
  filename: string | null = null,
  detail: string | null = null,
): Promise<boolean> {
  try {
    await run(connection, SQL_EVENT, [randomUUID(), keyId, workspaceId, action, filename ? filename.slice(0, 255) : null, detail ? detail.slice(0, 120) : null])
    return true
  } catch (e) {
    console.error(`key event not recorded action=${action} code=${(e as { code?: string }).code ?? 'unknown'}`)
    return false
  }
}
