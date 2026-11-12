// Server-only: a daily cap per bot on the shared demo model.
//
// Every widget question that the owner's own model or backend does not
// answer goes to this deployment's shared Groq key, which every bot shares.
// Without a cap, one busy site could use up the quota for all of them. So
// each bot gets SHARED_MODEL_DAILY_LIMIT questions per UTC day (default 200;
// "0" or "off" removes the cap). Bots on the owner's own model are never
// counted.
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
  database?: { connection: ParsedConnection; workspaceId: string }
}

export type ClaimResult = { allowed: true } | { allowed: false; cap: number }

/** Never throws. Call only for questions the shared model would answer. */
export async function claimSharedModelQuestion(bot: SharedModelBot, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<ClaimResult> {
  const cap = sharedModelDailyLimit(env)
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
