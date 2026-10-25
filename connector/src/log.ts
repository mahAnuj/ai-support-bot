import { createHash } from 'node:crypto'

// The server's only log lines. They hold an operation, a key fingerprint,
// an outcome code, a status and a duration. Never the URL, DATABASE_URL, a
// key id, secret, signature, model key, question, passage text or any body.

export type Op = 'health' | 'documents' | 'search' | 'answer' | 'unknown'

export type Outcome =
  | 'ok'
  | `unauthorized:${string}`
  | 'bad_request'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'upstream_error'
  | 'internal'

/** 8 hex characters of SHA-256: enough to tell keys apart, not the key id itself. */
export function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8)
}

export interface RequestLog {
  op: Op
  keyId: string | null
  outcome: Outcome
  status: number
  ms: number
}

export function formatRequestLine(entry: RequestLog): string {
  const key = entry.keyId === null ? '-' : `#${fingerprint(entry.keyId)}`
  return `connector op=${entry.op} key=${key} outcome=${entry.outcome} status=${entry.status} ms=${Math.max(0, Math.round(entry.ms))}`
}

export function logRequest(entry: RequestLog): void {
  console.log(formatRequestLine(entry))
}

export interface StartLog {
  port: number
  keys: number
  answer: boolean
  schema: string
}

export function formatStartLine(entry: StartLog): string {
  return `connector start port=${entry.port} keys=${entry.keys} answer=${entry.answer ? 'on' : 'off'} schema=${entry.schema}`
}

export function logStart(entry: StartLog): void {
  console.log(formatStartLine(entry))
}

/** A handler failure: the op and a code (a Postgres SQLSTATE or a fixed word), never the message. */
export function logError(op: Op, code: string): void {
  const safe = /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : 'unknown'
  console.error(`connector error op=${op} code=${safe}`)
}
