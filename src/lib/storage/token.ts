// Server-only: purpose-bound AES-256-GCM tokens. The key is read from process.env per call, never at import.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { StorageError } from './errors'

export const BUILDER_TOKEN_PREFIX = 'sbb1_'
export const WIDGET_TOKEN_PREFIX = 'sbw1_'
// Fits a widget token for the longest normalised connection string (3000 chars -> 4187-char token).
export const MAX_TOKEN_LENGTH = 4200

const KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/
const BODY_PATTERN = /^[A-Za-z0-9_-]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IV_LENGTH = 12
const TAG_LENGTH = 16

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

type Prefix = typeof BUILDER_TOKEN_PREFIX | typeof WIDGET_TOKEN_PREFIX

function seal(prefix: Prefix, plaintext: string, key: Buffer | null | undefined): string {
  const k = key ?? getTokenKey()
  if (!k) throw new StorageError('storage_unavailable')
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', k, iv)
  cipher.setAAD(Buffer.from(prefix))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return prefix + Buffer.concat([iv, tag, ciphertext]).toString('base64url')
}

function open(prefix: Prefix, token: unknown, key: Buffer | null | undefined): Record<string, unknown> | null {
  try {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !token.startsWith(prefix)) return null
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
    const plaintext = Buffer.concat([
      decipher.update(body.subarray(IV_LENGTH + TAG_LENGTH)),
      decipher.final(),
    ]).toString('utf8')
    const parsed: unknown = JSON.parse(plaintext)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const obj = parsed as Record<string, unknown>
    const purpose = prefix === BUILDER_TOKEN_PREFIX ? 'b' : 'w'
    if (obj.v !== 1 || obj.p !== purpose || typeof obj.c !== 'string') return null
    if (typeof obj.w !== 'string' || !UUID_PATTERN.test(obj.w)) return null
    return obj
  } catch {
    return null
  }
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

export function isBuilderTokenShape(s: unknown): boolean {
  return typeof s === 'string' && s.startsWith(BUILDER_TOKEN_PREFIX)
}

export function isWidgetTokenShape(s: unknown): boolean {
  return typeof s === 'string' && s.startsWith(WIDGET_TOKEN_PREFIX)
}
