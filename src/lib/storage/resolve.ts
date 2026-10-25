// Server-only: the single place routes get a KnowledgeStore from.
import { NextResponse } from 'next/server'
import { checkConnectorBaseUrl } from '../connector/client'
import { connectorErrorResponse, openConnectorHeader } from '../connector/resolve'
import {
  CONNECTOR_ERROR_STATUS,
  ConnectorError,
  isConnectorError,
  type ConnectorConfig,
  type ConnectorWidgetSettings,
} from '../connector/shared'
import { openWidgetTokenV3 } from '../connector/token'
import type { OwnerModelConfig } from '../model/shared'
import { normalizeOrigin, type OriginPolicy } from '../origins'
import type { ParsedConnection } from './connection'
import { isPrivateHostAllowed, revalidateNormalizedConnection } from './connection'
import {
  STORAGE_ERROR_MESSAGES,
  STORAGE_TOKEN_HEADER,
  StorageError,
  mapDriverError,
  type StorageErrorCode,
} from './errors'
import { fingerprint, keyLabel, workspaceLabel } from './log'
import { memoryStore } from './memory-store'
import { createPostgresStore } from './pg-store'
import {
  MAX_TOKEN_LENGTH,
  MAX_WIDGET_TOKEN_V2_LENGTH,
  MAX_WIDGET_TOKEN_V3_LENGTH,
  WIDGET_TOKEN_V2_PREFIX,
  WIDGET_TOKEN_V3_PREFIX,
  isBuilderTokenShape,
  isConnectorTokenShape,
  isModelTokenShape,
  isStorageEnabled,
  isWidgetTokenShape,
  openBuilderToken,
  openWidgetToken,
  openWidgetTokenV2,
} from './token'
import type { KnowledgeStore, StoreKind, WidgetRecord } from './types'

export type BuilderContext =
  | { kind: 'memory'; store: KnowledgeStore }
  | { kind: 'postgres'; store: KnowledgeStore; workspaceId: string; connection: ParsedConnection; label: string }
  // No store: every route that reads or writes documents must branch on kind.
  | { kind: 'connector'; connector: ConnectorConfig; answer: boolean; label: string; store?: undefined }

// Carries the HTTP status like StorageError does, so callers can read error.status on either kind.
export type BuilderConnectorError = ConnectorError & { readonly status: number }

export type BuilderResolution = { ok: true; ctx: BuilderContext } | { ok: false; error: StorageError | BuilderConnectorError }

export interface WidgetContext {
  store: KnowledgeStore
  widget: WidgetRecord
  kind: StoreKind
  label: string
  access: OriginPolicy
  // Only an sbw2_ token carries an owner model; everything else answers with the demo model.
  model: OwnerModelConfig | null
}

// An sbw3_ widget: the token is the whole record, and documents live on the owner's backend.
export interface ConnectorWidgetContext {
  kind: 'connector'
  widget: WidgetRecord
  label: string
  access: OriginPolicy
  connector: ConnectorConfig
  answer: boolean
  // Only when answer === false; null means the demo model.
  model: OwnerModelConfig | null
  settings: ConnectorWidgetSettings
  store?: undefined
}

export type WidgetResolution =
  | { ok: true; ctx: WidgetContext | ConnectorWidgetContext }
  | { ok: false; status: 403 | 404 | 503; code: StorageErrorCode | 'widget_not_found' }

const WIDGET_NOT_FOUND = { ok: false, status: 404, code: 'widget_not_found' } as const

// Which field a list came from decides how it matches, never its format: exact origins
// (token or memory record) win, then the legacy hostname list, then any site.
export function widgetAccessPolicy(widget: WidgetRecord, tokenOrigins: readonly string[] = []): OriginPolicy {
  const origins = tokenOrigins.length > 0 ? tokenOrigins : (widget.allowed_origins ?? [])
  if (origins.length > 0) return { kind: 'exact', origins: [...origins] }
  if (widget.allowed_domains.length > 0) return { kind: 'legacy', domains: [...widget.allowed_domains] }
  return { kind: 'any' }
}

function originsAreNormalized(origins: readonly string[]): boolean {
  return origins.every((o) => {
    const n = normalizeOrigin(o)
    return n.ok && n.origin === o
  })
}

type LoadResult = { ok: true; store: KnowledgeStore; widget: WidgetRecord } | Extract<WidgetResolution, { ok: false }>

async function loadPostgresWidget(conn: string, workspaceId: string, widgetId: string): Promise<LoadResult> {
  // Re-validate so the current private-host policy applies to tokens issued under an older one.
  const validated = revalidateNormalizedConnection(conn, { allowPrivate: isPrivateHostAllowed() })
  if (!validated.ok) return { ok: false, status: 403, code: validated.code }

  const store = createPostgresStore(validated.connection, workspaceId)
  let widget: WidgetRecord | null
  try {
    widget = await store.getWidget(widgetId)
  } catch (e) {
    return { ok: false, status: 503, code: mapDriverError(e).code }
  }
  if (!widget) return WIDGET_NOT_FOUND
  return { ok: true, store, widget }
}

function builderError(code: StorageErrorCode): BuilderResolution {
  return { ok: false, error: new StorageError(code) }
}

function withStatus(err: ConnectorError): BuilderConnectorError {
  return Object.assign(err, { status: CONNECTOR_ERROR_STATUS[err.code] })
}

// Sync and I/O-free: a bad token is rejected before any pool or DNS work can start.
export function resolveBuilderStore(request: Request): BuilderResolution {
  const header = request.headers.get(STORAGE_TOKEN_HEADER)
  if (header === null) return { ok: true, ctx: { kind: 'memory', store: memoryStore } }
  if (!isStorageEnabled()) {
    return isConnectorTokenShape(header)
      ? { ok: false, error: withStatus(new ConnectorError('connector_unavailable')) }
      : builderError('storage_unavailable')
  }
  if (isWidgetTokenShape(header) || isModelTokenShape(header)) return builderError('token_wrong_purpose')

  if (isConnectorTokenShape(header)) {
    const opened = openConnectorHeader(header)
    if (!opened.ok) return { ok: false, error: withStatus(opened.error) }
    const { connector, answer, label } = opened
    return { ok: true, ctx: { kind: 'connector', connector, answer, label } }
  }

  const payload = openBuilderToken(header)
  if (!payload) return builderError('invalid_token')

  const validated = revalidateNormalizedConnection(payload.conn, { allowPrivate: isPrivateHostAllowed() })
  if (!validated.ok) return builderError(validated.code)

  const connection = validated.connection
  const workspaceId = payload.workspaceId
  return {
    ok: true,
    ctx: {
      kind: 'postgres',
      store: createPostgresStore(connection, workspaceId),
      workspaceId,
      connection,
      label: workspaceLabel(workspaceId),
    },
  }
}

export function rejectWidgetTokenHeader(request: Request): StorageError | null {
  const header = request.headers.get(STORAGE_TOKEN_HEADER)
  return isWidgetTokenShape(header) || isModelTokenShape(header) ? new StorageError('token_wrong_purpose') : null
}

function resolveConnectorWidget(key: string): WidgetResolution {
  const payload = openWidgetTokenV3(key)
  if (!payload || !originsAreNormalized(payload.origins)) return WIDGET_NOT_FOUND
  const label = keyLabel(key)

  // The live private-host policy applies to embeds issued under an older one; the caller is not told why.
  const checked = checkConnectorBaseUrl(payload.connector.baseUrl)
  if (!checked.ok) {
    console.log(`widget connector refused code=${checked.code} key=${label}`)
    return WIDGET_NOT_FOUND
  }

  const { settings, origins } = payload
  const widget: WidgetRecord = {
    id: fingerprint(key),
    business_id: '',
    knowledge_base_id: '',
    widget_key: key,
    name: settings.title,
    title: settings.title,
    welcome_message: settings.welcomeMessage,
    primary_color: settings.primaryColor,
    position: settings.position,
    size: settings.size,
    allowed_domains: [],
    allowed_origins: origins,
    is_active: true,
    created_at: new Date(0),
    updated_at: new Date(0),
    system_prompt: settings.systemPrompt,
    role_context: settings.roleContext,
  }
  return {
    ok: true,
    ctx: {
      kind: 'connector',
      widget,
      label,
      access: widgetAccessPolicy(widget, origins),
      connector: payload.connector,
      answer: payload.answer,
      model: payload.answer ? null : (payload.model ?? null),
      settings,
    },
  }
}

export async function resolveWidget(key: unknown): Promise<WidgetResolution> {
  if (typeof key !== 'string') return WIDGET_NOT_FOUND
  const isV2 = key.startsWith(WIDGET_TOKEN_V2_PREFIX)
  const isV3 = key.startsWith(WIDGET_TOKEN_V3_PREFIX)
  const maxLength = isV3 ? MAX_WIDGET_TOKEN_V3_LENGTH : isV2 ? MAX_WIDGET_TOKEN_V2_LENGTH : MAX_TOKEN_LENGTH
  if (key.length > maxLength) return WIDGET_NOT_FOUND

  if (key.startsWith('widget-')) {
    const widget = await memoryStore.getWidget(key)
    // A sealed widget's plain key must not bypass the allowed sites carried in its token.
    if (!widget || widget.sealed) return WIDGET_NOT_FOUND
    return {
      ok: true,
      ctx: {
        store: memoryStore,
        widget,
        kind: 'memory',
        label: keyLabel(key),
        access: widgetAccessPolicy(widget),
        model: null,
      },
    }
  }

  if (isBuilderTokenShape(key) || isModelTokenShape(key) || isConnectorTokenShape(key)) {
    return { ok: false, status: 403, code: 'token_wrong_purpose' }
  }
  if (!isWidgetTokenShape(key)) return WIDGET_NOT_FOUND

  if (!isStorageEnabled()) return { ok: false, status: 503, code: 'storage_unavailable' }

  if (isV3) return resolveConnectorWidget(key)

  if (isV2) {
    const payload = openWidgetTokenV2(key)
    if (!payload || !originsAreNormalized(payload.origins)) return WIDGET_NOT_FOUND
    const { source, origins } = payload
    const model = payload.model ?? null

    if (source.kind === 'memory') {
      const widget = await memoryStore.getWidget(source.widgetKey)
      if (!widget) return WIDGET_NOT_FOUND
      return {
        ok: true,
        ctx: {
          store: memoryStore,
          widget: { ...widget, widget_key: key },
          kind: 'memory',
          label: keyLabel(key),
          access: widgetAccessPolicy(widget, origins),
          model,
        },
      }
    }

    const loaded = await loadPostgresWidget(source.conn, source.workspaceId, source.widgetId)
    if (!loaded.ok) return loaded
    return {
      ok: true,
      ctx: {
        store: loaded.store,
        widget: { ...loaded.widget, widget_key: key },
        kind: 'postgres',
        label: keyLabel(key),
        access: widgetAccessPolicy(loaded.widget, origins),
        model,
      },
    }
  }

  const payload = openWidgetToken(key)
  if (!payload) return WIDGET_NOT_FOUND

  const loaded = await loadPostgresWidget(payload.conn, payload.workspaceId, payload.widgetId)
  if (!loaded.ok) return loaded
  return {
    ok: true,
    ctx: {
      store: loaded.store,
      widget: { ...loaded.widget, widget_key: key },
      kind: 'postgres',
      label: keyLabel(key),
      access: widgetAccessPolicy(loaded.widget),
      model: null,
    },
  }
}

export function storageErrorResponse(err: StorageError): NextResponse {
  const message = STORAGE_ERROR_MESSAGES[err.code]
  return NextResponse.json({ error: message, code: err.code, details: message }, { status: err.status })
}

export function builderErrorResponse(err: StorageError | ConnectorError): NextResponse {
  return isConnectorError(err) ? connectorErrorResponse(err) : storageErrorResponse(err)
}
