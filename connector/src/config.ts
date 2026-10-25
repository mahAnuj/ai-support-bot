import { KEY_ID_PATTERN, SECRET_PATTERN } from './signing.js'

export interface ModelSettings {
  baseUrl: string
  model: string
  apiKey: string
}

export interface Config {
  databaseUrl: string
  /** key id -> secret */
  keys: ReadonlyMap<string, string>
  port: number
  host: string
  /** Mount prefix removed before routing and signature checks, or null. */
  basePath: string | null
  /** Set only when all three model variables are set; /v1/answer is advertised only then. */
  model: ModelSettings | null
  transformersCacheDir: string | null
}

export type Env = Record<string, string | undefined>

/** Names the variable only. A value can be a secret, so it never appears in the message. */
export class ConfigError extends Error {
  constructor(
    readonly variable: string,
    problem: 'is required' | 'is invalid' | 'has a duplicate key id',
  ) {
    super(`${variable} ${problem}`)
    this.name = 'ConfigError'
  }
}

export const BASE_PATH_PATTERN = /^(\/[A-Za-z0-9._~-]+)+$/
export const DEFAULT_PORT = 8080
export const DEFAULT_HOST = '0.0.0.0'
const MODEL_ID_MAX = 200
const MODEL_KEY_MAX = 512
const MODEL_URL_MAX = 500

function value(env: Env, name: string): string | undefined {
  const raw = env[name]
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

function parseKeys(raw: string | undefined): Map<string, string> {
  const keys = new Map<string, string>()
  if (raw === undefined) return keys
  for (const entry of raw.split(',')) {
    const item = entry.trim()
    if (item === '') continue
    const colon = item.indexOf(':')
    if (colon < 0) throw new ConfigError('CONNECTOR_KEYS', 'is invalid')
    const id = item.slice(0, colon)
    const secret = item.slice(colon + 1)
    if (!KEY_ID_PATTERN.test(id) || !SECRET_PATTERN.test(secret)) throw new ConfigError('CONNECTOR_KEYS', 'is invalid')
    if (keys.has(id)) throw new ConfigError('CONNECTOR_KEYS', 'has a duplicate key id')
    keys.set(id, secret)
  }
  return keys
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT
  if (!/^[0-9]{1,5}$/.test(raw)) throw new ConfigError('PORT', 'is invalid')
  const port = Number(raw)
  if (port < 1 || port > 65535) throw new ConfigError('PORT', 'is invalid')
  return port
}

function parseModelBaseUrl(raw: string): string {
  if (raw.length > MODEL_URL_MAX) throw new ConfigError('CONNECTOR_MODEL_BASE_URL', 'is invalid')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConfigError('CONNECTOR_MODEL_BASE_URL', 'is invalid')
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.search || url.hash) {
    throw new ConfigError('CONNECTOR_MODEL_BASE_URL', 'is invalid')
  }
  return raw.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
}

function parseModel(env: Env): ModelSettings | null {
  const baseUrl = value(env, 'CONNECTOR_MODEL_BASE_URL')
  const model = value(env, 'CONNECTOR_MODEL')
  const apiKey = value(env, 'CONNECTOR_MODEL_API_KEY')
  if (baseUrl === undefined || model === undefined || apiKey === undefined) return null
  if (model.length > MODEL_ID_MAX) throw new ConfigError('CONNECTOR_MODEL', 'is invalid')
  if (apiKey.length > MODEL_KEY_MAX || /[\r\n]/.test(apiKey)) throw new ConfigError('CONNECTOR_MODEL_API_KEY', 'is invalid')
  return { baseUrl: parseModelBaseUrl(baseUrl), model, apiKey }
}

/** Pure: reads only the given object. Throws ConfigError. */
export function parseConfig(env: Env): Config {
  const databaseUrl = value(env, 'DATABASE_URL')
  if (databaseUrl === undefined) throw new ConfigError('DATABASE_URL', 'is required')

  const basePath = value(env, 'CONNECTOR_BASE_PATH') ?? null
  if (basePath !== null && !BASE_PATH_PATTERN.test(basePath)) throw new ConfigError('CONNECTOR_BASE_PATH', 'is invalid')

  const host = value(env, 'HOST') ?? DEFAULT_HOST

  return {
    databaseUrl,
    keys: parseKeys(env.CONNECTOR_KEYS),
    port: parsePort(value(env, 'PORT')),
    host,
    basePath,
    model: parseModel(env),
    transformersCacheDir: value(env, 'TRANSFORMERS_CACHE_DIR') ?? null,
  }
}
