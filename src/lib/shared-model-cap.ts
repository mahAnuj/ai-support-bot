// Server-only: a daily cap per bot on the shared demo model.
//
// Every widget question that the owner's own model or backend does not
// answer goes to this deployment's shared Groq key, which every bot shares.
// Without a cap, one busy site could use up the quota for all of them. So
// each bot gets SHARED_MODEL_DAILY_LIMIT questions per UTC day (default 200;
// "0" or "off" removes the cap). Bots on the owner's own model are never
// counted.
//
// Per site, the operator can set another limit or none, in
// SHARED_MODEL_SITE_LIMITS: "anujmahajan.com=off, shubhagya.com=1000". It
// applies only to a bot locked to an exact list of allowed sites, for a
// request from one of them (the chat route checks the Origin against that
// list first), so a bot open to every site cannot borrow another site's
// limit by naming it. Matched on the exact hostname: list www.example.com
// separately. Bot owners cannot change it; it is the deployment's setting.
//
// Two counters, and a question is refused when either is full:
// - In the bot's own database (support_bot.shared_model_usage), one row per
//   workspace per day, claimed with one atomic upsert, so the cap holds
//   across every server instance. Only database-backed bots have one, and
//   the owner can edit it, so it is a fair-use limit, not a security
//   boundary.
// - In this server instance's memory, keyed by bot. The only counter for
//   bots without a database, and a backstop when the table is missing.
import type { ParsedConnection } from './storage/connection'
import { safeErrorSummary } from './storage/errors'
import { getPool } from './storage/pg-pool'

export const DEFAULT_SHARED_MODEL_DAILY_LIMIT = 200

/** The cap, or null for no cap. */
export function sharedModelDailyLimit(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.SHARED_MODEL_DAILY_LIMIT?.trim().toLowerCase()
  if (!raw) return DEFAULT_SHARED_MODEL_DAILY_LIMIT
  if (raw === '0' || raw === 'off') return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_SHARED_MODEL_DAILY_LIMIT
}

type SiteLimits = Map<string, number | null>
let siteLimitsCache: { raw: string; map: SiteLimits } | null = null

function parseLimit(raw: string): number | null | undefined {
  const v = raw.trim().toLowerCase()
  if (v === '0' || v === 'off' || v === 'none') return null
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/** "host=limit" pairs, comma or newline separated; a host may be written as a URL. Bad entries are skipped. */
export function parseSiteLimits(raw: string | undefined): SiteLimits {
  const map: SiteLimits = new Map()
  for (const entry of (raw ?? '').split(/[,\n]/)) {
    const eq = entry.lastIndexOf('=')
    if (eq <= 0) continue
    let host = entry.slice(0, eq).trim().toLowerCase()
    try { if (host.includes('://')) host = new URL(host).hostname } catch { continue }
    host = host.replace(/\/+$/, '')
    const limit = parseLimit(entry.slice(eq + 1))
    if (host && /^[a-z0-9.-]+$/.test(host) && limit !== undefined) map.set(host, limit)
  }
  return map
}

/** The limit for a bot, given the verified site it is answering on (or null when not verified). */
export function limitFor(site: string | null | undefined, env: NodeJS.ProcessEnv = process.env): number | null {
  const fallback = sharedModelDailyLimit(env)
  if (!site) return fallback
  const raw = env.SHARED_MODEL_SITE_LIMITS ?? ''
  if (siteLimitsCache?.raw !== raw) siteLimitsCache = { raw, map: parseSiteLimits(raw) }
  let host: string
  try { host = new URL(site).hostname.toLowerCase() } catch { return fallback }
  const own = siteLimitsCache.map.get(host)
  return own === undefined ? fallback : own
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10)

// Per instance: "bot:day" -> questions. Old days are pruned as the map grows.
const memory = new Map<string, number>()

function claimInMemory(bot: string, cap: number, now: Date): boolean {
  const day = utcDay(now)
  if (memory.size > 5000) for (const k of memory.keys()) if (!k.endsWith(`:${day}`)) memory.delete(k)
  const key = `${bot}:${day}`
  const used = memory.get(key) ?? 0
  if (used >= cap) return false
  memory.set(key, used + 1)
  return true
}

function releaseInMemory(bot: string, now: Date) {
  const key = `${bot}:${utcDay(now)}`
  const used = memory.get(key)
  if (used) memory.set(key, used - 1)
}

/** For tests. */
export function resetSharedModelMemory() {
  memory.clear()
}

const code = (e: unknown) => (e as { code?: unknown })?.code

/**
 * Takes one question from today's allowance in the bot's database.
 * true: allowed; false: the cap is reached; null: no counter there (no table,
 * or the database could not be written), so only the memory counter applies.
 */
async function claimInDatabase(connection: ParsedConnection, workspaceId: string, cap: number): Promise<boolean | null> {
  try {
    const r = await (await getPool(connection)).query(
      `INSERT INTO support_bot.shared_model_usage AS u (workspace_id, day, questions)
       VALUES ($1, (now() AT TIME ZONE 'utc')::date, 1)
       ON CONFLICT (workspace_id, day) DO UPDATE SET questions = u.questions + 1
       WHERE u.questions < $2
       RETURNING questions`,
      [workspaceId, cap],
    )
    return (r.rowCount ?? 0) > 0
  } catch (e) {
    if (code(e) !== '42P01') console.log(`shared model usage: not counted (${safeErrorSummary(e)})`)
    return null
  }
}

export interface SharedModelBot {
  /** Stable per bot: the workspace for a database-backed bot, else the widget. */
  id: string
  /** The request's origin, only when the bot is locked to exact sites and it is one of them. */
  site?: string | null
  database?: { connection: ParsedConnection; workspaceId: string }
}

export type ClaimResult = { allowed: true } | { allowed: false; cap: number }

/** Never throws. Call only for questions the shared model would answer. */
export async function claimSharedModelQuestion(bot: SharedModelBot, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<ClaimResult> {
  const cap = limitFor(bot.site, env)
  if (cap === null) return { allowed: true }
  if (!claimInMemory(bot.id, cap, now)) return { allowed: false, cap }
  if (bot.database) {
    const claimed = await claimInDatabase(bot.database.connection, bot.database.workspaceId, cap)
    if (claimed === false) {
      releaseInMemory(bot.id, now)
      return { allowed: false, cap }
    }
  }
  return { allowed: true }
}

/** Today's count for the owner's panel; null when the table is missing. */
export async function sharedModelUsedToday(connection: ParsedConnection, workspaceId: string): Promise<number | null> {
  try {
    const r = await (await getPool(connection)).query<{ questions: number }>(
      `SELECT questions FROM support_bot.shared_model_usage WHERE workspace_id = $1 AND day = (now() AT TIME ZONE 'utc')::date`,
      [workspaceId],
    )
    return r.rows[0]?.questions ?? 0
  } catch {
    return null
  }
}
