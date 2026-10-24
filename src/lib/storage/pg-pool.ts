import { createHash } from 'node:crypto'
import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import type { ConnectionOptions } from 'node:tls'
import { Pool } from 'pg'
import {
  classifyAddress,
  isPrivateHostAllowed,
  validateConnectionString,
  type ParsedConnection,
} from './connection'
import { StorageError, mapDriverError, safeErrorSummary } from './errors'

export const APPLICATION_NAME = 'ai-support-bot'

export const POOL_LIMITS = {
  maxConnections: 3,
  maxPools: 20,
  idleEvictMs: 600_000,
  idleClientMs: 30_000,
  connectTimeoutMs: 5_000,
  statementTimeoutMs: 10_000,
} as const

interface PoolEntry {
  promise: Promise<Pool>
  lastUsed: number
  fingerprint: string
}

const pools = new Map<string, PoolEntry>()

function cacheKey(connection: ParsedConnection): string {
  return createHash('sha256').update(connection.normalized).digest('hex')
}

function endEntry(entry: PoolEntry): void {
  entry.promise
    .then((pool) => pool.end())
    .catch((err: unknown) => {
      console.error('storage pool end error', safeErrorSummary(err))
    })
}

function removeEntry(key: string): void {
  const entry = pools.get(key)
  if (!entry) return
  pools.delete(key)
  endEntry(entry)
}

function sweepIdle(now: number): void {
  for (const [key, entry] of pools) {
    if (now - entry.lastUsed > POOL_LIMITS.idleEvictMs) removeEntry(key)
  }
}

function evictLeastRecentlyUsed(): void {
  let oldestKey: string | null = null
  let oldest = Infinity
  for (const [key, entry] of pools) {
    if (entry.lastUsed < oldest) {
      oldest = entry.lastUsed
      oldestKey = key
    }
  }
  if (oldestKey !== null) removeEntry(oldestKey)
}

async function resolveAddresses(host: string): Promise<string[]> {
  if (isIP(host)) return [host]
  try {
    const results = await dns.lookup(host, { all: true, verbatim: true })
    const addresses = results.map((r) => r.address)
    if (addresses.length === 0) throw new StorageError('host_not_found')
    return addresses
  } catch (err) {
    throw mapDriverError(err)
  }
}

async function create(connection: ParsedConnection): Promise<Pool> {
  const allowPrivate = isPrivateHostAllowed()
  const checked = validateConnectionString(connection.normalized, { allowPrivate })
  if (!checked.ok) throw new StorageError(checked.code)
  const conn = checked.connection

  const addresses = await resolveAddresses(conn.host)
  const classes = addresses.map((a) => classifyAddress(a))
  if (!allowPrivate && classes.some((c) => c !== 'public')) {
    throw new StorageError('private_host_not_allowed')
  }
  if (conn.sslmode === 'disable' && classes.some((c) => c === 'public')) {
    throw new StorageError('tls_required')
  }

  const servername = isIP(conn.host) ? undefined : conn.host
  let ssl: false | ConnectionOptions
  if (conn.sslmode === 'disable') {
    ssl = false
  } else {
    ssl = { rejectUnauthorized: conn.sslmode === 'verify-full' }
    if (servername) ssl.servername = servername
  }

  const pool = new Pool({
    host: addresses[0],
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: conn.database,
    ssl,
    max: POOL_LIMITS.maxConnections,
    connectionTimeoutMillis: POOL_LIMITS.connectTimeoutMs,
    idleTimeoutMillis: POOL_LIMITS.idleClientMs,
    statement_timeout: POOL_LIMITS.statementTimeoutMs,
    query_timeout: POOL_LIMITS.statementTimeoutMs,
    idle_in_transaction_session_timeout: POOL_LIMITS.statementTimeoutMs,
    application_name: APPLICATION_NAME,
    keepAlive: true,
  })
  pool.on('error', (err) => {
    console.error('storage pool error', safeErrorSummary(err))
  })
  pool.on('connect', () => {
    console.log(`storage pool connect db=${conn.fingerprint}`)
  })
  console.log(`storage pool created db=${conn.fingerprint}`)
  return pool
}

export async function getPool(connection: ParsedConnection): Promise<Pool> {
  const now = Date.now()
  sweepIdle(now)

  const key = cacheKey(connection)
  const hit = pools.get(key)
  if (hit) {
    hit.lastUsed = now
    return hit.promise
  }

  if (pools.size >= POOL_LIMITS.maxPools) evictLeastRecentlyUsed()

  const entry: PoolEntry = { promise: create(connection), lastUsed: now, fingerprint: connection.fingerprint }
  pools.set(key, entry)
  entry.promise.catch(() => {
    if (pools.get(key) === entry) pools.delete(key)
  })
  return entry.promise
}

export async function discardPool(connection: ParsedConnection): Promise<void> {
  const key = cacheKey(connection)
  const entry = pools.get(key)
  if (!entry) return
  pools.delete(key)
  try {
    const pool = await entry.promise
    await pool.end()
  } catch (err) {
    console.error('storage pool end error', safeErrorSummary(err))
  }
}

export function poolCount(): number {
  return pools.size
}
