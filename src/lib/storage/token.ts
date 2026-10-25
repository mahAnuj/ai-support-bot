// Server-only: purpose-bound AES-256-GCM tokens. The key is read from process.env per call, never at import.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { StorageError } from './errors'

export const BUILDER_TOKEN_PREFIX = 'sbb1_'
export const WIDGET_TOKEN_PREFIX = 'sbw1_'
export const WIDGET_TOKEN_V2_PREFIX = 'sbw2_'
// Fits a widget token for the longest normalised connection string (3000 chars -> 4187-char token).
export const MAX_TOKEN_LENGTH = 4200
// sbw2_ is compressed; a 3000-char connection string plus 10 x 255-char origins, all pseudo-random, seals to ~5,800.
export const MAX_WIDGET_TOKEN_V2_LENGTH = 6400

const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/
const BODY_PATTERN = /^[A-Za-z0-9_-]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IV_LENGTH = 12
const TAG_LENGTH = 16
const MAX_INFLATED_LENGTH = 16384
const MEMORY_WIDGET_KEY_PATTERN = /^widget-[A-Za-z0-9-]{1,80}$/
const MAX_TOKEN_ORIGINS = 10
const MAX_TOKEN_ORIGIN_LENGTH = 255

export function getTokenKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.EMBED_TOKEN_KEY?.trim()
  if (!raw || !KEY_PATTERN.test(raw)) return null
  const key = Buffer.from(raw, 'base64')
  return key.length === 32 ? key : null
}

export function isStorageEnabled(): boolean {
  return getTokenKey() !== null
}

export interface BuilderTokenPayload { conn: string; workspaceId: string }
export interface WidgetTokenPayload { conn: string; workspaceId: string; widgetId: string }

export type WidgetSource =
  | { kind: 'postgres'; conn: string; workspaceId: string; widgetId: string }
  | { kind: 'memory'; widgetKey: string }

export interface WidgetTokenV2Payload { source: WidgetSource; origins: string[] }

type Prefix = typeof BUILDER_TOKEN_PREFIX | typeof WIDGET_TOKEN_PREFIX | typeof WIDGET_TOKEN_V2_PREFIX

function seal(prefix: Prefix, plaintext: string, key: Buffer | null | undefined, compress = false): string {
  const k = key ?? getTokenKey()
  if (!k) throw new StorageError('storage_unavailable')
  const data = compress ? deflateRawSync(Buffer.from(plaintext, 'utf8')) : Buffer.from(plaintext, 'utf8')
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', k, iv)
  cipher.setAAD(Buffer.from(prefix))
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()])
  const tag = cipher.getAuthTag()
  return prefix + Buffer.concat([iv, tag, ciphertext]).toString('base64url')
}

function openObject(
  prefix: Prefix,
  token: unknown,
  key: Buffer | null | undefined,
  maxLength: number,
  compressed: boolean,
): Record<string, unknown> | null {
  try {
    if (typeof token !== 'string' || token.length > maxLength || !token.startsWith(prefix)) return null
    const k = key ?? getTokenKey()
    if (!k) return null
    const encoded = token.slice(prefix.length)
    if (!BODY_PATTERN.test(encoded)) return null
    const body = Buffer.from(encoded, 'base64url')
    // Reject non-canonical encodings: otherwise flipping unused trailing bits decodes to identical bytes.
    if (body.toString('base64url') !== encoded) return null
    if (body.length < IV_LENGTH + TAG_LENGTH + 1) return null
    const decipher = createDecipheriv('aes-256-gcm', k, body.subarray(0, IV_LENGTH))
    decipher.setAAD(Buffer.from(prefix))
    decipher.setAuthTag(body.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH))
    // final() throws unless the tag verifies, so inflation below only ever sees authenticated bytes.
    const decrypted = Buffer.concat([
      decipher.update(body.subarray(IV_LENGTH + TAG_LENGTH)),
      decipher.final(),
    ])
    const plain = compressed ? inflateRawSync(decrypted, { maxOutputLength: MAX_INFLATED_LENGTH }) : decrypted
    const parsed: unknown = JSON.parse(plain.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function open(prefix: typeof BUILDER_TOKEN_PREFIX | typeof WIDGET_TOKEN_PREFIX, token: unknown, key: Buffer | null | undefined): Record<string, unknown> | null {
  const obj = openObject(prefix, token, key, MAX_TOKEN_LENGTH, false)
  if (!obj) return null
  const purpose = prefix === BUILDER_TOKEN_PREFIX ? 'b' : 'w'
  if (obj.v !== 1 || obj.p !== purpose || typeof obj.c !== 'string') return null
  if (typeof obj.w !== 'string' || !UUID_PATTERN.test(obj.w)) return null
  return obj
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(obj).every((k) => keys.includes(k))
}

function readSource(s: unknown): WidgetSource | null {
  if (!isPlainObject(s)) return null
  if (s.k === 'pg') {
    if (!hasOnlyKeys(s, ['k', 'c', 'w', 'g'])) return null
    if (typeof s.c !== 'string' || s.c.length === 0) return null
    if (typeof s.w !== 'string' || !UUID_PATTERN.test(s.w)) return null
    if (typeof s.g !== 'string' || !UUID_PATTERN.test(s.g)) return null
    return { kind: 'postgres', conn: s.c, workspaceId: s.w, widgetId: s.g }
  }
  if (s.k === 'mem') {
    if (!hasOnlyKeys(s, ['k', 'r'])) return null
    if (typeof s.r !== 'string' || !MEMORY_WIDGET_KEY_PATTERN.test(s.r)) return null
    return { kind: 'memory', widgetKey: s.r }
  }
  return null
}

function readOrigins(o: unknown): string[] | null {
  if (!Array.isArray(o) || o.length > MAX_TOKEN_ORIGINS) return null
  for (const origin of o) {
    if (typeof origin !== 'string' || origin.length === 0 || origin.length > MAX_TOKEN_ORIGIN_LENGTH) return null
  }
  return [...o] as string[]
}

function sourceJson(source: WidgetSource): Record<string, string> {
  return source.kind === 'postgres'
    ? { k: 'pg', c: source.conn, w: source.workspaceId, g: source.widgetId }
    : { k: 'mem', r: source.widgetKey }
}

export function sealBuilderToken(p: BuilderTokenPayload, key?: Buffer): string {
  return seal(BUILDER_TOKEN_PREFIX, JSON.stringify({ v: 1, p: 'b', c: p.conn, w: p.workspaceId }), key)
}

export function sealWidgetToken(p: WidgetTokenPayload, key?: Buffer): string {
  return seal(WIDGET_TOKEN_PREFIX, JSON.stringify({ v: 1, p: 'w', c: p.conn, w: p.workspaceId, g: p.widgetId }), key)
}

export function openBuilderToken(token: unknown, key?: Buffer): BuilderTokenPayload | null {
  const obj = open(BUILDER_TOKEN_PREFIX, token, key)
  if (!obj) return null
  return { conn: obj.c as string, workspaceId: obj.w as string }
}

export function openWidgetToken(token: unknown, key?: Buffer): WidgetTokenPayload | null {
  const obj = open(WIDGET_TOKEN_PREFIX, token, key)
  if (!obj || typeof obj.g !== 'string' || !UUID_PATTERN.test(obj.g)) return null
  return { conn: obj.c as string, workspaceId: obj.w as string, widgetId: obj.g }
}

export function sealWidgetTokenV2(p: WidgetTokenV2Payload, key?: Buffer): string {
  const json = JSON.stringify({ v: 2, p: 'w', s: sourceJson(p.source), o: p.origins })
  const token = seal(WIDGET_TOKEN_V2_PREFIX, json, key, true)
  if (token.length > MAX_WIDGET_TOKEN_V2_LENGTH) throw new StorageError('embed_too_large')
  return token
}

export function openWidgetTokenV2(token: unknown, key?: Buffer): WidgetTokenV2Payload | null {
  const obj = openObject(WIDGET_TOKEN_V2_PREFIX, token, key, MAX_WIDGET_TOKEN_V2_LENGTH, true)
  if (!obj || !hasOnlyKeys(obj, ['v', 'p', 's', 'o'])) return null
  if (obj.v !== 2 || obj.p !== 'w') return null
  const source = readSource(obj.s)
  const origins = readOrigins(obj.o)
  if (!source || !origins) return null
  return { source, origins }
}

export function isBuilderTokenShape(s: unknown): boolean {
  return typeof s === 'string' && s.startsWith(BUILDER_TOKEN_PREFIX)
}

export function isWidgetTokenShape(s: unknown): boolean {
  return typeof s === 'string' && (s.startsWith(WIDGET_TOKEN_PREFIX) || s.startsWith(WIDGET_TOKEN_V2_PREFIX))
}
