// "Your bots": every database this browser has connected, one bot per site,
// so the owner can open any of them again without the connection string.
//
// Each entry keeps that database's builder link: the same sealed token the
// builder already keeps for the open database, so remembering several
// changes what this browser holds, not how it is protected. "Forget" and
// "Disconnect" remove an entry; nothing here is sent anywhere.

export const BOT_LIST_KEY = 'ai-support-bot.bots'
export const MAX_BOTS = 20

export interface SavedBot {
  /** The database, from the server (address only, never the login). */
  key: string
  /** e.g. "neondb on ep-cool-name.neon.tech" */
  label: string
  /** The owner's name for the bot, such as the site it is for. */
  name: string | null
  /** The builder link for this database. */
  token: string
}

export function parseBotList(raw: string | null): SavedBot[] {
  if (!raw) return []
  try {
    const list: unknown = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list
      .filter((b): b is SavedBot =>
        typeof b === 'object' && b !== null &&
        typeof b.key === 'string' && typeof b.label === 'string' && typeof b.token === 'string' &&
        (b.name === null || typeof b.name === 'string'))
      .map(({ key, label, name, token }) => ({ key, label, name, token }))
      .slice(0, MAX_BOTS)
  } catch {
    return []
  }
}

export function loadBotList(): SavedBot[] {
  try { return parseBotList(window.localStorage.getItem(BOT_LIST_KEY)) } catch { return [] }
}

function saveBotList(list: SavedBot[]): void {
  try { window.localStorage.setItem(BOT_LIST_KEY, JSON.stringify(list.slice(0, MAX_BOTS))) } catch { /* storage blocked: the list lasts for this page only */ }
}

/** Adds the bot or updates it in place (same database), keeping the list's order. */
export function upsertBot(list: SavedBot[], bot: SavedBot): SavedBot[] {
  const i = list.findIndex((b) => b.key === bot.key)
  return i === -1 ? [...list, bot] : list.map((b, j) => (j === i ? bot : b))
}

export function rememberBot(bot: SavedBot): SavedBot[] {
  const next = upsertBot(loadBotList(), bot)
  saveBotList(next)
  return next
}

/** Removes by database key, or by builder link (on disconnect, when only the link is known). */
export function forgetBot(match: { key?: string; token?: string | null }): SavedBot[] {
  const next = loadBotList().filter((b) => !(match.key && b.key === match.key) && !(match.token && b.token === match.token))
  saveBotList(next)
  return next
}
