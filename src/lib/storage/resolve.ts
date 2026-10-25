// Server-only: the single place routes get a KnowledgeStore from.
import { NextResponse } from 'next/server'
import type { ParsedConnection } from './connection'
import { isPrivateHostAllowed, revalidateNormalizedConnection } from './connection'
import {
  STORAGE_ERROR_MESSAGES,
  STORAGE_TOKEN_HEADER,
  StorageError,
  mapDriverError,
  type StorageErrorCode,
} from './errors'
import { keyLabel, workspaceLabel } from './log'
import { memoryStore } from './memory-store'
import { createPostgresStore } from './pg-store'
import {
  MAX_TOKEN_LENGTH,
  isBuilderTokenShape,
  isStorageEnabled,
  isWidgetTokenShape,
  openBuilderToken,
  openWidgetToken,
} from './token'
import type { KnowledgeStore, StoreKind, WidgetRecord } from './types'

export type BuilderContext =
  | { kind: 'memory'; store: KnowledgeStore }
  | { kind: 'postgres'; store: KnowledgeStore; workspaceId: string; connection: ParsedConnection; label: string }

export type BuilderResolution = { ok: true; ctx: BuilderContext } | { ok: false; error: StorageError }

export interface WidgetContext { store: KnowledgeStore; widget: WidgetRecord; kind: StoreKind; label: string }

export type WidgetResolution =
  | { ok: true; ctx: WidgetContext }
  | { ok: false; status: 403 | 404 | 503; code: StorageErrorCode | 'widget_not_found' }

const WIDGET_NOT_FOUND = { ok: false, status: 404, code: 'widget_not_found' } as const

function builderError(code: StorageErrorCode): BuilderResolution {
  return { ok: false, error: new StorageError(code) }
}

// Sync and I/O-free: a bad token is rejected before any pool or DNS work can start.
export function resolveBuilderStore(request: Request): BuilderResolution {
  const header = request.headers.get(STORAGE_TOKEN_HEADER)
  if (header === null) return { ok: true, ctx: { kind: 'memory', store: memoryStore } }
  if (!isStorageEnabled()) return builderError('storage_unavailable')
  if (isWidgetTokenShape(header)) return builderError('token_wrong_purpose')

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
  return isWidgetTokenShape(request.headers.get(STORAGE_TOKEN_HEADER)) ? new StorageError('token_wrong_purpose') : null
}

export async function resolveWidget(key: unknown): Promise<WidgetResolution> {
  if (typeof key !== 'string' || key.length > MAX_TOKEN_LENGTH) return WIDGET_NOT_FOUND

  if (key.startsWith('widget-')) {
    const widget = await memoryStore.getWidget(key)
    if (!widget) return WIDGET_NOT_FOUND
    return { ok: true, ctx: { store: memoryStore, widget, kind: 'memory', label: keyLabel(key) } }
  }

  if (isBuilderTokenShape(key)) return { ok: false, status: 403, code: 'token_wrong_purpose' }
  if (!isWidgetTokenShape(key)) return WIDGET_NOT_FOUND

  if (!isStorageEnabled()) return { ok: false, status: 503, code: 'storage_unavailable' }
  const payload = openWidgetToken(key)
  if (!payload) return WIDGET_NOT_FOUND

  // Re-validate so the current private-host policy applies to tokens issued under an older one.
  const validated = revalidateNormalizedConnection(payload.conn, { allowPrivate: isPrivateHostAllowed() })
  if (!validated.ok) return { ok: false, status: 403, code: validated.code }

  const store = createPostgresStore(validated.connection, payload.workspaceId)
  let widget: WidgetRecord | null
  try {
    widget = await store.getWidget(payload.widgetId)
  } catch (e) {
    return { ok: false, status: 503, code: mapDriverError(e).code }
  }
  if (!widget) return WIDGET_NOT_FOUND

  return {
    ok: true,
    ctx: { store, widget: { ...widget, widget_key: key }, kind: 'postgres', label: keyLabel(key) },
  }
}

export function storageErrorResponse(err: StorageError): NextResponse {
  const message = STORAGE_ERROR_MESSAGES[err.code]
  return NextResponse.json({ error: message, code: err.code, details: message }, { status: err.status })
}
