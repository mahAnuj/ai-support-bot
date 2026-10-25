import type { QueryResult } from 'pg'

// Nonces are kept at least twice the 300 s signature window, so a request
// cannot be replayed while its timestamp is still accepted.
export const NONCE_RETENTION_SECONDS = 600
export const NONCE_PURGE_INTERVAL_MS = 60_000

export interface NonceStore {
  /** Records (keyId, nonce). Resolves false when the pair was already recorded. */
  remember(keyId: string, nonce: string): Promise<boolean>
}

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<QueryResult>
}

const INSERT_NONCE =
  'INSERT INTO support_bot_connector.nonces (key_id, nonce) VALUES ($1, $2) ON CONFLICT DO NOTHING'
const PURGE_NONCES =
  "DELETE FROM support_bot_connector.nonces WHERE seen_at < now() - interval '600 seconds'"

/** Durable nonce store: survives a restart and is shared by every replica on the same database. */
export class PgNonceStore implements NonceStore {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly db: Queryable,
    private readonly onPurgeError: (error: unknown) => void = () => {},
  ) {}

  async remember(keyId: string, nonce: string): Promise<boolean> {
    const result = await this.db.query(INSERT_NONCE, [keyId, nonce])
    return result.rowCount === 1
  }

  async purge(): Promise<number> {
    const result = await this.db.query(PURGE_NONCES)
    return result.rowCount ?? 0
  }

  /** Purges once now and then every minute. The timer never keeps the process alive. */
  start(): void {
    if (this.timer) return
    const run = () => {
      this.purge().catch(this.onPurgeError)
    }
    run()
    this.timer = setInterval(run, NONCE_PURGE_INTERVAL_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

/** In-process nonce store for tests. Not durable. */
export class MemoryNonceStore implements NonceStore {
  private readonly seen = new Map<string, number>()

  constructor(private readonly nowMs: () => number = Date.now) {}

  async remember(keyId: string, nonce: string): Promise<boolean> {
    const now = this.nowMs()
    for (const [entry, at] of this.seen) {
      if (now - at > NONCE_RETENTION_SECONDS * 1000) this.seen.delete(entry)
    }
    const entry = `${keyId}\n${nonce}`
    if (this.seen.has(entry)) return false
    this.seen.set(entry, now)
    return true
  }

  get size(): number {
    return this.seen.size
  }
}
