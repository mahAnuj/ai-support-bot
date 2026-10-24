// Client-safe: no node imports. Imported by both API routes and browser components.

export const STORAGE_TOKEN_HEADER = 'x-storage-token'
export const STORAGE_LOCALSTORAGE_KEY = 'ai-support-bot.storage-token'

export const STORAGE_ERROR_CODES = [
  'storage_unavailable', 'invalid_connection_string', 'unsupported_scheme', 'connection_string_too_long',
  'tls_required', 'private_host_not_allowed', 'host_not_found', 'db_unreachable', 'db_timeout', 'tls_failed',
  'auth_failed', 'database_not_found', 'pgvector_missing', 'insufficient_privilege', 'schema_mismatch',
  'schema_missing', 'pooler_unsupported', 'rate_limited', 'invalid_token', 'token_wrong_purpose',
  'workspace_not_found', 'storage_error',
] as const

export type StorageErrorCode = typeof STORAGE_ERROR_CODES[number]

export const STORAGE_ERROR_STATUS: Record<StorageErrorCode, number> = {
  invalid_connection_string: 400,
  unsupported_scheme: 400,
  connection_string_too_long: 400,
  tls_required: 400,
  private_host_not_allowed: 400,
  host_not_found: 502,
  db_unreachable: 502,
  tls_failed: 502,
  db_timeout: 504,
  auth_failed: 422,
  database_not_found: 422,
  pgvector_missing: 422,
  insufficient_privilege: 422,
  schema_mismatch: 422,
  schema_missing: 422,
  pooler_unsupported: 422,
  rate_limited: 429,
  invalid_token: 401,
  token_wrong_purpose: 403,
  workspace_not_found: 404,
  storage_unavailable: 503,
  storage_error: 500,
}

export const STORAGE_ERROR_MESSAGES: Record<StorageErrorCode, string> = {
  unsupported_scheme: 'Use a connection string that starts with postgres:// or postgresql://.',
  invalid_connection_string: "That doesn't look like a Postgres connection string. It should look like postgresql://user:password@host:5432/database.",
  connection_string_too_long: 'That connection string is longer than 1,000 characters.',
  tls_required: 'This database must be reached over TLS. Remove sslmode=disable, or use sslmode=require.',
  private_host_not_allowed: "This server can't connect to private, local or link-local addresses. Use your database's public host name.",
  host_not_found: "The database host name couldn't be found. Check the part after the @.",
  db_unreachable: "The database didn't accept a connection. Check the host and port, and that it accepts connections from the internet.",
  db_timeout: "The database didn't answer in time. Check the host and port, and any firewall or IP allowlist.",
  tls_failed: "A secure connection couldn't be set up. If your provider uses its own certificate authority (Supabase does), add ?sslmode=require to the end of the connection string.",
  auth_failed: 'The database rejected the user name or password.',
  database_not_found: "That database doesn't exist on the server. Check the name after the last /.",
  pgvector_missing: "The pgvector extension isn't installed in this database. Run this once as an admin, then try again: CREATE EXTENSION vector;",
  insufficient_privilege: "This database user can't create or use the support_bot tables. Run the setup SQL as an admin, then try again.",
  schema_mismatch: 'The support_bot tables in this database were made for a different version or embedding size. Nothing was changed.',
  schema_missing: 'The support_bot tables are missing from this database. Run the setup SQL, then connect again.',
  pooler_unsupported: "The connection pooler rejected this app's connection settings. Use the direct or session-mode connection string (usually port 5432).",
  rate_limited: 'Too many connection attempts from this network. Wait a minute and try again.',
  storage_unavailable: "Connecting a database isn't available on this deployment.",
  invalid_token: "This browser's link to your database is no longer valid. Connecting again starts a new, empty workspace. Your earlier documents stay in your database, but this builder can't reopen them.",
  token_wrong_purpose: "This key can't be used here.",
  workspace_not_found: "The workspace for this link is no longer in your database. Connecting again starts a new, empty workspace.",
  storage_error: 'Something went wrong talking to your database. Try again.',
}

function isStorageErrorCode(value: unknown): value is StorageErrorCode {
  return typeof value === 'string' && (STORAGE_ERROR_CODES as readonly string[]).includes(value)
}

export class StorageError extends Error {
  readonly code: StorageErrorCode
  readonly status: number

  constructor(code: StorageErrorCode) {
    // message is the code itself so an accidental error.message echo leaks nothing.
    super(code)
    Object.setPrototypeOf(this, new.target.prototype)
    this.name = 'StorageError'
    this.code = code
    this.status = STORAGE_ERROR_STATUS[code]
  }
}

export function isStorageError(e: unknown): e is StorageError {
  return e instanceof StorageError
}

export function storageErrorMessage(code: unknown): string {
  return isStorageErrorCode(code) ? STORAGE_ERROR_MESSAGES[code] : STORAGE_ERROR_MESSAGES.storage_error
}

const DRIVER_CODE_MAP: Record<string, StorageErrorCode> = {
  '28P01': 'auth_failed',
  '28000': 'auth_failed',
  '3D000': 'database_not_found',
  '42501': 'insufficient_privilege',
  '42704': 'pgvector_missing',
  '42883': 'pgvector_missing',
  '42P01': 'schema_missing',
  '3F000': 'schema_missing',
  '57014': 'db_timeout',
  '08P01': 'pooler_unsupported',
  '53300': 'db_unreachable',
  ECONNREFUSED: 'db_unreachable',
  EHOSTUNREACH: 'db_unreachable',
  ENETUNREACH: 'db_unreachable',
  ECONNRESET: 'db_unreachable',
  EPIPE: 'db_unreachable',
  ETIMEDOUT: 'db_timeout',
  ENOTFOUND: 'host_not_found',
  EAI_AGAIN: 'host_not_found',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'tls_failed',
  SELF_SIGNED_CERT_IN_CHAIN: 'tls_failed',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'tls_failed',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'tls_failed',
  CERT_HAS_EXPIRED: 'tls_failed',
}

const TIMEOUT_MESSAGES = [
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout',
  'Query read timeout',
]

const TLS_UNSUPPORTED_MESSAGE = 'The server does not support SSL connections'

function readField(err: unknown, field: 'code' | 'message'): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined
  const value = (err as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : undefined
}

export function mapDriverError(err: unknown): StorageError {
  if (isStorageError(err)) return err

  const code = readField(err, 'code')
  if (code !== undefined) {
    const mapped = DRIVER_CODE_MAP[code]
    if (mapped) return new StorageError(mapped)
    if (code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_')) return new StorageError('tls_failed')
  }

  const message = readField(err, 'message')
  if (message !== undefined) {
    if (TIMEOUT_MESSAGES.some((m) => message.includes(m))) return new StorageError('db_timeout')
    if (message.includes(TLS_UNSUPPORTED_MESSAGE)) return new StorageError('tls_failed')
  }

  return new StorageError('storage_error')
}

export function safeErrorSummary(err: unknown): string {
  const rawCode = readField(err, 'code')
  // Only print codes that look like driver/system codes; never free text.
  const code = rawCode !== undefined && /^[A-Za-z0-9_]{1,64}$/.test(rawCode) ? rawCode : 'none'
  return `code=${code} mapped=${mapDriverError(err).code}`
}
