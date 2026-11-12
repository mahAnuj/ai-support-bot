// Server-only: daily counts for the analytics panel, kept in the owner's database.
//
// Numbers only, never visitor text, so counting stays on even when the
// conversation log is off (the owner can turn it off). One row per workspace
// per UTC day, updated with a single upsert after each widget reply.
//
// The "match score" is the retrieval match score (0-100, see matchScore in
// src/lib/embeddings.ts): how closely the best passage matched the question.
// It is not a probability that the answer is right. Its mean, minimum and
// low-match count are taken over answers that used at least one document;
// questions with no matching document are counted separately.
import type { ParsedConnection } from './connection'
import { mapDriverError, safeErrorSummary } from './errors'
import { getPool } from './pg-pool'

export const LOW_MATCH = 40
export const MIN_DAYS = 7
export const MAX_DAYS = 365
export const DEFAULT_DAYS = 30

// The visitor rule tells the model to say it does not have the information,
// so that phrasing is what a "don't know" answer looks like. A pattern match:
// it can miss a reworded refusal, which the panel says.
const DONT_KNOW = /\b(i\s+(?:do\s+not|don['’]t)\s+have\s+(?:that|this|any|the|a\s+specific|specific|enough)\b|i\s+(?:do\s+not|don['’]t)\s+have\s+information\b|i['’]m\s+not\s+able\s+to\s+(?:confirm|find|answer)\b|i\s+(?:can(?:no|['’])t)\s+find\s+(?:that|this|any)\b)/i

export function looksLikeDontKnow(answer: string): boolean {
  return DONT_KNOW.test(answer)
}

export interface DayStats {
  day: string
  questions: number
  matched: number
  noMatch: number
  dontKnow: number
  failures: number
  meanScore: number | null
  minScore: number | null
  lowScore: number
}

export interface StatsReport {
  available: boolean
  enabled: boolean
  days: DayStats[]
  totals: Omit<DayStats, 'day'>
  lowMatch: number
}

const code = (e: unknown) => (e as { code?: unknown })?.code
const MISSING_TABLE = '42P01'
const MISSING_COLUMN = '42703'

async function pool(connection: ParsedConnection) {
  return getPool(connection)
}

/** Whether counting is on for this workspace. On unless the owner turned it off. */
export async function statsEnabled(connection: ParsedConnection, workspaceId: string): Promise<boolean> {
  try {
    const r = await (await pool(connection)).query<{ stats_enabled: boolean }>(
      'SELECT stats_enabled FROM support_bot.log_settings WHERE workspace_id = $1',
      [workspaceId],
    )
    return r.rows[0]?.stats_enabled ?? true
  } catch (e) {
    if (code(e) === MISSING_TABLE || code(e) === MISSING_COLUMN) return true
    throw mapDriverError(e)
  }
}

export async function setStatsEnabled(connection: ParsedConnection, workspaceId: string, enabled: boolean): Promise<void> {
  try {
    await (await pool(connection)).query(
      `INSERT INTO support_bot.log_settings (workspace_id, stats_enabled, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (workspace_id) DO UPDATE SET stats_enabled = EXCLUDED.stats_enabled, updated_at = now()`,
      [workspaceId, enabled],
    )
  } catch (e) {
    // A settings table created before stats_enabled existed: the route says how to add it.
    if (code(e) === MISSING_COLUMN) throw e
    throw mapDriverError(e)
  }
}

export type StatEvent =
  | { failure: true }
  | { failure: false; matched: boolean; score: number; answer: string }

/** Adds one reply to today's row. Best effort; never throws. */
export async function recordDailyStat(connection: ParsedConnection, workspaceId: string, event: StatEvent): Promise<boolean> {
  try {
    if (!(await statsEnabled(connection, workspaceId))) return false
    const f = event.failure
    const matched = !f && event.matched ? 1 : 0
    const noMatch = !f && !event.matched ? 1 : 0
    const dontKnow = !f && looksLikeDontKnow(event.answer) ? 1 : 0
    const score = !f && event.matched ? Math.max(0, Math.min(100, Math.round(event.score))) : null
    await (await pool(connection)).query(
      `INSERT INTO support_bot.daily_stats AS s (workspace_id, day, questions, matched, no_match, dont_know, failures, score_sum, score_count, score_min, low_score)
       VALUES ($1, (now() AT TIME ZONE 'utc')::date, 1, $2, $3, $4, $5, COALESCE($6::int, 0), CASE WHEN $6::int IS NULL THEN 0 ELSE 1 END, $6::smallint,
               CASE WHEN $6::int IS NOT NULL AND $6::int < $7 THEN 1 ELSE 0 END)
       ON CONFLICT (workspace_id, day) DO UPDATE SET
         questions = s.questions + 1, matched = s.matched + EXCLUDED.matched, no_match = s.no_match + EXCLUDED.no_match,
         dont_know = s.dont_know + EXCLUDED.dont_know, failures = s.failures + EXCLUDED.failures,
         score_sum = s.score_sum + EXCLUDED.score_sum, score_count = s.score_count + EXCLUDED.score_count,
         score_min = LEAST(s.score_min, EXCLUDED.score_min), low_score = s.low_score + EXCLUDED.low_score`,
      [workspaceId, matched, noMatch, dontKnow, f ? 1 : 0, score, LOW_MATCH],
    )
    return true
  } catch (e) {
    console.log(`daily stats: not written (${safeErrorSummary(e)})`)
    return false
  }
}

type Row = {
  day: Date; questions: number; matched: number; no_match: number; dont_know: number; failures: number
  score_sum: number; score_count: number; score_min: number | null; low_score: number
}

export function normalizeDays(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isInteger(n)) return DEFAULT_DAYS
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, n))
}

/** The last `days` days, newest last, with a row for every day (zeros on quiet days). */
export async function readDailyStats(connection: ParsedConnection, workspaceId: string, daysWanted: unknown): Promise<StatsReport> {
  const days = normalizeDays(daysWanted)
  const enabled = await statsEnabled(connection, workspaceId)
  let rows: Row[]
  try {
    const r = await (await pool(connection)).query<Row>(
      `SELECT d::date AS day, COALESCE(s.questions, 0) AS questions, COALESCE(s.matched, 0) AS matched, COALESCE(s.no_match, 0) AS no_match,
              COALESCE(s.dont_know, 0) AS dont_know, COALESCE(s.failures, 0) AS failures, COALESCE(s.score_sum, 0) AS score_sum,
              COALESCE(s.score_count, 0) AS score_count, s.score_min, COALESCE(s.low_score, 0) AS low_score
       FROM generate_series((now() AT TIME ZONE 'utc')::date - ($2::int - 1), (now() AT TIME ZONE 'utc')::date, interval '1 day') AS d
       LEFT JOIN support_bot.daily_stats s ON s.workspace_id = $1 AND s.day = d::date
       ORDER BY d`,
      [workspaceId, days],
    )
    rows = r.rows
  } catch (e) {
    const empty = { questions: 0, matched: 0, noMatch: 0, dontKnow: 0, failures: 0, meanScore: null, minScore: null, lowScore: 0 }
    if (code(e) === MISSING_TABLE) return { available: false, enabled, days: [], totals: empty, lowMatch: LOW_MATCH }
    throw mapDriverError(e)
  }
  const out: DayStats[] = rows.map((r) => ({
    day: (r.day instanceof Date ? r.day.toISOString() : String(r.day)).slice(0, 10),
    questions: r.questions,
    matched: r.matched,
    noMatch: r.no_match,
    dontKnow: r.dont_know,
    failures: r.failures,
    meanScore: r.score_count > 0 ? Math.round(r.score_sum / r.score_count) : null,
    minScore: r.score_min,
    lowScore: r.low_score,
  }))
  const sum = (k: 'questions' | 'matched' | 'noMatch' | 'dontKnow' | 'failures' | 'lowScore') => out.reduce((a, d) => a + d[k], 0)
  const scoreSum = rows.reduce((a, r) => a + r.score_sum, 0)
  const scoreCount = rows.reduce((a, r) => a + r.score_count, 0)
  const mins = rows.map((r) => r.score_min).filter((v): v is number => v !== null)
  return {
    available: true,
    enabled,
    days: out,
    totals: {
      questions: sum('questions'),
      matched: sum('matched'),
      noMatch: sum('noMatch'),
      dontKnow: sum('dontKnow'),
      failures: sum('failures'),
      meanScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null,
      minScore: mins.length ? Math.min(...mins) : null,
      lowScore: sum('lowScore'),
    },
    lowMatch: LOW_MATCH,
  }
}
