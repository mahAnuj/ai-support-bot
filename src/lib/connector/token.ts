// Server-only: the connector token payloads. Sealing and opening reuse the AES-256-GCM code in storage/token.ts.
import { API_KEY_PATTERN, MODEL_ID_PATTERN, MODEL_LIMITS, type OwnerModelConfig } from '../model/shared'
import { checkModelBaseUrl } from '../model/url-guard'
import { MAX_ALLOWED_ORIGINS, MAX_ORIGIN_LENGTH } from '../origins'
import { StorageError } from '../storage/errors'
import {
  CONNECTOR_TOKEN_PREFIX,
  MAX_TOKEN_LENGTH,
  MAX_WIDGET_TOKEN_V3_LENGTH,
  WIDGET_TOKEN_V3_PREFIX,
  openPrefixed,
  sealPrefixed,
} from '../storage/token'
import {
  CONNECTOR_LIMITS,
  KEY_ID_PATTERN,
  SECRET_PATTERN,
  type ConnectorConfig,
  type ConnectorWidgetSettings,
  type WidgetTokenV3Payload,
} from './shared'

// A highly compressible plaintext must still open, so sbw3_ inflates up to 64 KiB and seal refuses anything larger.
export const MAX_WIDGET_TOKEN_V3_PLAINTEXT_BYTES = 65_536
export const WIDGET_SYSTEM_PROMPT_CHARS = 4000
export const WIDGET_ROLE_CONTEXT_CHARS = 2000

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const POSITIONS = ['bottom-right', 'bottom-left'] as const
const SIZES = ['small', 'medium', 'large'] as const
const CONNECTOR_TOKEN_FIELDS = ['v', 'p', 'u', 'k', 's', 'a'] as const
const WIDGET_V3_FIELDS = ['v', 'p', 'c', 'o', 'a', 't', 'wm', 'pc', 'ps', 'sz', 'sp', 'rc', 'm'] as const

export interface ConnectorTokenPayload extends ConnectorConfig {
  answer: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(obj).every((k) => keys.includes(k))
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

// Shape only: the resolver and the client apply the live private-host policy on every use.
function readConnector(u: unknown, k: unknown, s: unknown): ConnectorConfig | null {
  if (!isBoundedString(u, 1, CONNECTOR_LIMITS.baseUrl) || !checkModelBaseUrl(u, { allowPrivate: true }).ok) return null
  if (typeof k !== 'string' || !KEY_ID_PATTERN.test(k)) return null
  if (typeof s !== 'string' || !SECRET_PATTERN.test(s)) return null
  return { baseUrl: u, keyId: k, secret: s }
}

function readOrigins(o: unknown): string[] | null {
  if (!Array.isArray(o) || o.length === 0 || o.length > MAX_ALLOWED_ORIGINS) return null
  for (const origin of o) {
    if (!isBoundedString(origin, 1, MAX_ORIGIN_LENGTH)) return null
  }
  return [...o] as string[]
}

function readModel(m: unknown): OwnerModelConfig | null {
  if (!isPlainObject(m) || !hasOnlyKeys(m, ['u', 'id', 'k'])) return null
  const { u, id, k } = m
  if (!isBoundedString(u, 1, MODEL_LIMITS.baseUrl) || !checkModelBaseUrl(u, { allowPrivate: true }).ok) return null
  if (!isBoundedString(id, 1, MODEL_LIMITS.modelId) || !MODEL_ID_PATTERN.test(id)) return null
  if (!isBoundedString(k, 1, MODEL_LIMITS.apiKey) || !API_KEY_PATTERN.test(k)) return null
  return { baseUrl: u, model: id, apiKey: k }
}

function readSettings(obj: Record<string, unknown>): ConnectorWidgetSettings | null {
  const { t, wm, pc, ps, sz, sp, rc } = obj
  if (!isBoundedString(t, 1, CONNECTOR_LIMITS.widgetTitle)) return null
  if (!isBoundedString(wm, 1, CONNECTOR_LIMITS.widgetWelcome)) return null
  if (typeof pc !== 'string' || !COLOR_PATTERN.test(pc)) return null
  if (typeof ps !== 'string' || !(POSITIONS as readonly string[]).includes(ps)) return null
  if (typeof sz !== 'string' || !(SIZES as readonly string[]).includes(sz)) return null
  if (sp !== undefined && !isBoundedString(sp, 0, WIDGET_SYSTEM_PROMPT_CHARS)) return null
  if (rc !== undefined && !isBoundedString(rc, 0, WIDGET_ROLE_CONTEXT_CHARS)) return null
  const settings: ConnectorWidgetSettings = {
    title: t,
    welcomeMessage: wm,
    primaryColor: pc,
    position: ps as ConnectorWidgetSettings['position'],
    size: sz as ConnectorWidgetSettings['size'],
  }
  if (sp !== undefined) settings.systemPrompt = sp as string
  if (rc !== undefined) settings.roleContext = rc as string
  return settings
}

export function sealConnectorToken(p: ConnectorTokenPayload, key?: Buffer): string {
  const json = JSON.stringify({ v: 1, p: 'c', u: p.baseUrl, k: p.keyId, s: p.secret, a: p.answer })
  return sealPrefixed(CONNECTOR_TOKEN_PREFIX, json, key)
}

export function openConnectorToken(token: unknown, key?: Buffer): ConnectorTokenPayload | null {
  const obj = openPrefixed(CONNECTOR_TOKEN_PREFIX, token, key, MAX_TOKEN_LENGTH, false)
  if (!obj || !hasOnlyKeys(obj, CONNECTOR_TOKEN_FIELDS)) return null
  if (obj.v !== 1 || obj.p !== 'c' || typeof obj.a !== 'boolean') return null
  const connector = readConnector(obj.u, obj.k, obj.s)
  return connector ? { ...connector, answer: obj.a } : null
}

// Throws StorageError('embed_too_large') when the plaintext is over 64 KiB or the token is over `cap`.
// The owner model is sealed only when the backend does not answer (answer === false).
export function sealWidgetTokenV3(p: WidgetTokenV3Payload, key?: Buffer, opts: { cap?: number } = {}): string {
  const { connector, settings } = p
  const body: Record<string, unknown> = {
    v: 3,
    p: 'w',
    c: { u: connector.baseUrl, k: connector.keyId, s: connector.secret },
    o: p.origins,
    a: p.answer,
    t: settings.title,
    wm: settings.welcomeMessage,
    pc: settings.primaryColor,
    ps: settings.position,
    sz: settings.size,
  }
  if (settings.systemPrompt !== undefined) body.sp = settings.systemPrompt
  if (settings.roleContext !== undefined) body.rc = settings.roleContext
  if (!p.answer && p.model) body.m = { u: p.model.baseUrl, id: p.model.model, k: p.model.apiKey }

  const json = JSON.stringify(body)
  if (Buffer.byteLength(json, 'utf8') > MAX_WIDGET_TOKEN_V3_PLAINTEXT_BYTES) throw new StorageError('embed_too_large')
  const token = sealPrefixed(WIDGET_TOKEN_V3_PREFIX, json, key, true)
  if (token.length > (opts.cap ?? MAX_WIDGET_TOKEN_V3_LENGTH)) throw new StorageError('embed_too_large')
  return token
}

// Origins are checked for shape here; the resolver also requires each to be in normalised form.
export function openWidgetTokenV3(token: unknown, key?: Buffer): WidgetTokenV3Payload | null {
  const obj = openPrefixed(
    WIDGET_TOKEN_V3_PREFIX,
    token,
    key,
    MAX_WIDGET_TOKEN_V3_LENGTH,
    true,
    MAX_WIDGET_TOKEN_V3_PLAINTEXT_BYTES,
  )
  if (!obj || !hasOnlyKeys(obj, WIDGET_V3_FIELDS)) return null
  if (obj.v !== 3 || obj.p !== 'w' || typeof obj.a !== 'boolean') return null
  if (!isPlainObject(obj.c) || !hasOnlyKeys(obj.c, ['u', 'k', 's'])) return null
  const connector = readConnector(obj.c.u, obj.c.k, obj.c.s)
  const origins = readOrigins(obj.o)
  const settings = readSettings(obj)
  if (!connector || !origins || !settings) return null

  const payload: WidgetTokenV3Payload = { connector, origins, answer: obj.a, settings }
  if (obj.m === undefined) return payload
  if (obj.a) return null
  const model = readModel(obj.m)
  return model ? { ...payload, model } : null
}
