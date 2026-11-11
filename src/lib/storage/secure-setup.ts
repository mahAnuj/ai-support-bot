// Server-only: one-click secure setup.
//
// The owner connects with an admin login (Neon's neondb_owner, Supabase's
// postgres). Instead of keeping that login, the app creates its own login that
// can reach only the support_bot tables, checks that it works, and carries on
// with it, so the builder link, embed codes and automation keys never hold the
// admin password. The admin login is used for this one request and dropped.
//
// It is the automatic version of scripts/support-bot-role.sql, with the same
// grants, plus default privileges so tables added in later versions are
// granted too. Anything that goes wrong leaves the database as it was (the new
// login is dropped) and the caller falls back to the login it was given.
import { randomBytes } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { validateConnectionString, type ParsedConnection } from './connection'
import { safeErrorSummary } from './errors'
import { discardPool, getPool } from './pg-pool'

export const LIMITED_ROLE = 'support_bot_app'
const ROLE_NAME = /^support_bot_app(_[0-9a-f]{6})?$/
const PASSWORD = /^[0-9a-f]{48}$/

export type SecureSetupResult =
  // A new limited login was created and verified; use `connection` from now on.
  | { status: 'created'; role: string; connection: ParsedConnection }
  // The given login cannot create logins, so it is probably limited already. Used as is.
  | { status: 'already_limited' }
  // The login could create logins but setup failed; nothing was left behind. Used as is.
  | { status: 'not_possible'; reason: SetupFailure }

export type SetupFailure = 'could_not_create' | 'new_login_failed'

interface RoleInfo { privileged: boolean; user: string }

async function roleInfo(client: PoolClient): Promise<RoleInfo> {
  const r = await client.query<{ rolsuper: boolean; rolcreaterole: boolean; user: string }>(
    'SELECT rolsuper, rolcreaterole, current_user AS user FROM pg_roles WHERE rolname = current_user',
  )
  const row = r.rows[0]
  return { privileged: !!row && (row.rolsuper || row.rolcreaterole), user: row?.user ?? '' }
}

// Installs pgvector when it is missing and the login is allowed to. Errors are
// swallowed: ensureSchema reports a missing extension with the exact fix.
export async function tryInstallVector(pool: Pool): Promise<void> {
  try {
    const r = await pool.query<{ has: boolean }>("SELECT to_regtype('vector') IS NOT NULL AS has")
    if (r.rows[0]?.has) return
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
  } catch (e) {
    console.log(`secure setup: could not install pgvector (${safeErrorSummary(e)})`)
  }
}

/**
 * The limited login's user name as the server expects it. Poolers that route
 * by user name (Supabase's Supavisor: "postgres.<project>") need the same
 * suffix on the new login; a plain user name gets none. If the guess is wrong,
 * the verification step fails and the setup is rolled back.
 */
export function limitedUserName(ownerUser: string, role: string): string {
  const dot = ownerUser.indexOf('.')
  return dot > 0 && dot < ownerUser.length - 1 ? `${role}.${ownerUser.slice(dot + 1)}` : role
}

export function limitedConnectionString(owner: ParsedConnection, user: string, password: string): string {
  const url = new URL(owner.normalized)
  url.username = encodeURIComponent(user)
  url.password = encodeURIComponent(password)
  return url.toString()
}

function grantStatements(role: string): string[] {
  const r = `"${role}"`
  return [
    `GRANT USAGE ON SCHEMA support_bot TO ${r}`,
    `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA support_bot TO ${r}`,
    `GRANT DELETE ON support_bot.documents, support_bot.chunks, support_bot.conversations TO ${r}`,
    // Tables a later version adds are created by this admin login, so grant them in advance.
    `ALTER DEFAULT PRIVILEGES IN SCHEMA support_bot GRANT SELECT, INSERT, UPDATE ON TABLES TO ${r}`,
    `ALTER ROLE ${r} SET search_path = support_bot, public, extensions`,
  ]
}

// The exact reverse of grantStatements. DROP OWNED BY would be shorter, but it
// needs the privileges of the role being dropped, which an admin that is not a
// superuser (Neon's neondb_owner) does not have; revoking needs only ADMIN.
export function revokeStatements(role: string, withExtensions: boolean): string[] {
  const r = `"${role}"`
  return [
    `ALTER DEFAULT PRIVILEGES IN SCHEMA support_bot REVOKE ALL ON TABLES FROM ${r}`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA support_bot FROM ${r}`,
    `REVOKE ALL ON SCHEMA support_bot FROM ${r}`,
    ...(withExtensions ? [`REVOKE ALL ON SCHEMA extensions FROM ${r}`] : []),
    `DROP ROLE IF EXISTS ${r}`,
  ]
}

async function dropRole(pool: Pool, role: string): Promise<void> {
  try {
    const ext = await pool.query("SELECT 1 FROM pg_namespace WHERE nspname = 'extensions'")
    for (const sql of revokeStatements(role, !!ext.rowCount)) await pool.query(sql)
  } catch (e) {
    console.log(`secure setup: could not drop ${role} after a failed setup (${safeErrorSummary(e)})`)
  }
}

async function verify(conn: ParsedConnection, role: string): Promise<boolean> {
  // A brand-new login can take a moment to reach a connection pooler.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const pool = await getPool(conn)
      const r = await pool.query<{ user: string; can: boolean }>(
        "SELECT current_user AS user, has_table_privilege('support_bot.chunks', 'INSERT') AS can FROM support_bot.meta LIMIT 1",
      )
      if (r.rows[0]?.user === role && r.rows[0]?.can === true) return true
      return false
    } catch (e) {
      await discardPool(conn)
      if (attempt === 2) {
        console.log(`secure setup: the new login did not work (${safeErrorSummary(e)})`)
        return false
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
    }
  }
  return false
}

/**
 * Creates and verifies a limited login. Call after ensureSchema() on the admin
 * pool, so the tables it grants on exist. Never throws.
 */
export async function secureSetup(owner: ParsedConnection, allowPrivate: boolean): Promise<SecureSetupResult> {
  let pool: Pool
  let client: PoolClient
  try {
    pool = await getPool(owner)
    client = await pool.connect()
  } catch (e) {
    console.log(`secure setup: no admin connection (${safeErrorSummary(e)})`)
    return { status: 'not_possible', reason: 'could_not_create' }
  }

  let role = ''
  let created = false
  try {
    const info = await roleInfo(client)
    if (!info.privileged) return { status: 'already_limited' }
    if (ROLE_NAME.test(info.user)) return { status: 'already_limited' }

    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [LIMITED_ROLE])
    // An existing support_bot_app has a password only its owner knows, and other
    // embeds may use it, so it is never changed: a new, suffixed login is made instead.
    role = exists.rowCount === 0 ? LIMITED_ROLE : `${LIMITED_ROLE}_${randomBytes(3).toString('hex')}`
    const password = randomBytes(24).toString('hex')
    // Identifiers and literals cannot be bound as parameters in DDL. Both are
    // generated here and checked against strict patterns, so neither can carry a quote.
    if (!ROLE_NAME.test(role) || !PASSWORD.test(password)) throw new Error('generated name or password failed its check')

    await client.query('BEGIN')
    await client.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`)
    created = true
    for (const sql of grantStatements(role)) await client.query(sql)
    const ext = await client.query("SELECT 1 FROM pg_namespace WHERE nspname = 'extensions'")
    if (ext.rowCount) await client.query(`GRANT USAGE ON SCHEMA extensions TO "${role}"`)
    await client.query('COMMIT')

    const checked = validateConnectionString(
      limitedConnectionString(owner, limitedUserName(owner.user, role), password),
      { allowPrivate },
    )
    if (!checked.ok || !(await verify(checked.connection, role))) {
      if (checked.ok) await discardPool(checked.connection)
      await dropRole(pool, role)
      return { status: 'not_possible', reason: 'new_login_failed' }
    }
    console.log(`secure setup: created ${role} db=${owner.fingerprint}`)
    return { status: 'created', role, connection: checked.connection }
  } catch (e) {
    try { await client.query('ROLLBACK') } catch { /* not in a transaction */ }
    console.log(`secure setup: could not create a limited login (${safeErrorSummary(e)})`)
    if (created) await dropRole(pool, role)
    return { status: 'not_possible', reason: 'could_not_create' }
  } finally {
    client.release()
  }
}
