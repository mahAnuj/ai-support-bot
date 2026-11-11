// Server-only: the conversation log, kept in the owner's own database.
//
// Off by default. When the owner turns it on, each widget question and its
// answer is written to support_bot.conversations, but only if the widget told
// the visitor so (the widget shows a notice and says it did; see
// src/lib/widget-script.ts). Nothing identifies the visitor: no IP, no user
// agent, no cookie; a random chat id groups one conversation's turns.
// Entries older than the owner's retention period are deleted on every write.
// The builder preview is never logged: that is the owner testing.
import { randomUUID } from 'node:crypto'
import type { ParsedConnection } from './connection'
import { mapDriverError, safeErrorSummary } from './errors'
import { getPool } from './pg-pool'

export const DEFAULT_RETENTION_DAYS = 90
export const MIN_RETENTION_DAYS = 1
export const MAX_RETENTION_DAYS = 730
export const RETENTION_PRESETS = [30, 90, 180, 365] as const
export const LIST_PAGE_SIZE = 50
export const CSV_MAX_ROWS = 5000
const MAX_ANSWER_CHARS = 8000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface LogSettings {
  enabled: boolean
  retentionDays: number
  // False when the log tables do not exist yet (a limited login after an upgrade).
  available: boolean
}

export interface LoggedTurn {
  id: string
  chatId: string | null
  question: string
  answer: string
  matched: boolean
  sources: string[]
  at: string
}

export function normalizeRetention(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isInteger(n)) return DEFAULT_RETENTION_DAYS
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, n))
}

const missingTable = (e: unknown) => (e as { code?: unknown })?.code === '42P01'

async function q<T extends Record<string, unknown>>(connection: ParsedConnection, sql: string, params: unknown[]) {
  const pool = await getPool(connection)
  return pool.query<T>(sql, params)
}

export async function getLogSettings(connection: ParsedConnection, workspaceId: string): Promise<LogSettings> {
  try {
    const r = await q<{ enabled: boolean; retention_days: number }>(
      connection,
      'SELECT enabled, retention_days FROM support_bot.log_settings WHERE workspace_id = $1',
      [workspaceId],
    )
    const row = r.rows[0]
    return { enabled: row?.enabled ?? false, retentionDays: row?.retention_days ?? DEFAULT_RETENTION_DAYS, available: true }
  } catch (e) {
    if (missingTable(e)) return { enabled: false, retentionDays: DEFAULT_RETENTION_DAYS, available: false }
    throw mapDriverError(e)
  }
}

export async function setLogSettings(connection: ParsedConnection, workspaceId: string, enabled: boolean, retention: unknown): Promise<LogSettings> {
  const days = normalizeRetention(retention)
  try {
    await q(
      connection,
      `INSERT INTO support_bot.log_settings (workspace_id, enabled, retention_days, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (workspace_id) DO UPDATE SET enabled = EXCLUDED.enabled, retention_days = EXCLUDED.retention_days, updated_at = now()`,
      [workspaceId, enabled, days],
    )
    // A shorter period applies at once, not at the next visitor question.
    await q(connection, 'DELETE FROM support_bot.conversations WHERE workspace_id = $1 AND created_at < now() - make_interval(days => $2)', [workspaceId, days])
  } catch (e) {
    throw mapDriverError(e)
  }
  return { enabled, retentionDays: days, available: true }
}

/**
 * Writes one question and answer if the log is on. Best effort and never
 * throws: a visitor's answer must not fail because the log could not be written.
 */
export async function recordTurn(
  connection: ParsedConnection,
  workspaceId: string,
  turn: { chatId: unknown; question: string; answer: string; matched: boolean; sources: string[] },
): Promise<boolean> {
  try {
    const settings = await getLogSettings(connection, workspaceId)
    if (!settings.available || !settings.enabled) return false
    const chatId = typeof turn.chatId === 'string' && UUID.test(turn.chatId) ? turn.chatId : null
    await q(
      connection,
      'INSERT INTO support_bot.conversations (id, workspace_id, chat_id, question, answer, matched, sources) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [randomUUID(), workspaceId, chatId, turn.question, turn.answer.slice(0, MAX_ANSWER_CHARS), turn.matched, turn.sources.slice(0, 20)],
    )
    await q(connection, 'DELETE FROM support_bot.conversations WHERE workspace_id = $1 AND created_at < now() - make_interval(days => $2)', [workspaceId, settings.retentionDays])
    return true
  } catch (e) {
    console.log(`conversation log: not written (${safeErrorSummary(e)})`)
    return false
  }
}

function toTurn(r: { id: string; chat_id: string | null; question: string; answer: string; matched: boolean; sources: string[]; created_at: Date }): LoggedTurn {
  return { id: r.id, chatId: r.chat_id, question: r.question, answer: r.answer, matched: r.matched, sources: r.sources ?? [], at: r.created_at.toISOString() }
}

export async function listTurns(
  connection: ParsedConnection,
  workspaceId: string,
  opts: { unmatchedOnly?: boolean; before?: string | null; limit?: number } = {},
): Promise<LoggedTurn[]> {
  const limit = Math.min(opts.limit ?? LIST_PAGE_SIZE, CSV_MAX_ROWS)
  const before = opts.before && !Number.isNaN(Date.parse(opts.before)) ? new Date(opts.before) : null
  try {
    const r = await q<{ id: string; chat_id: string | null; question: string; answer: string; matched: boolean; sources: string[]; created_at: Date }>(
      connection,
      `SELECT id, chat_id, question, answer, matched, sources, created_at FROM support_bot.conversations
       WHERE workspace_id = $1 AND ($2::boolean IS NOT TRUE OR matched = false) AND ($3::timestamptz IS NULL OR created_at < $3)
       ORDER BY created_at DESC, id LIMIT $4`,
      [workspaceId, opts.unmatchedOnly === true, before, limit],
    )
    return r.rows.map(toTurn)
  } catch (e) {
    if (missingTable(e)) return []
    throw mapDriverError(e)
  }
}

export async function deleteAllTurns(connection: ParsedConnection, workspaceId: string): Promise<number> {
  try {
    const r = await q(connection, 'DELETE FROM support_bot.conversations WHERE workspace_id = $1', [workspaceId])
    return r.rowCount ?? 0
  } catch (e) {
    if (missingTable(e)) return 0
    throw mapDriverError(e)
  }
}

// RFC 4180 quoting, plus a leading quote on anything a spreadsheet would run
// as a formula: visitors write these fields, so "=HYPERLINK(...)" is a real input.
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function turnsToCsv(turns: LoggedTurn[]): string {
  const header = ['time', 'chat', 'question', 'answer', 'matched_documents', 'sources']
  const lines = turns.map((t) => [t.at, t.chatId ?? '', t.question, t.answer, t.matched ? 'yes' : 'no', t.sources.join('; ')].map(csvCell).join(','))
  return [header.join(','), ...lines].join('\r\n') + '\r\n'
}
