'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  STORAGE_ERROR_CODES,
  STORAGE_LOCALSTORAGE_KEY,
  STORAGE_TOKEN_HEADER,
  storageErrorMessage,
  type StorageErrorCode,
} from '@/lib/storage/errors'

export interface StorageConnection {
  ready: boolean
  available: boolean
  connected: boolean
  token: string | null
  documents: { filename: string; chunks: number }[] | null
  connecting: boolean
  error: { code: StorageErrorCode; message: string } | null
  lastMigration: { documents: number; chunks: number } | null
  requestHeaders: Record<string, string>
  connect(connectionString: string, sessionId: string | null): Promise<boolean>
  disconnect(): void
  refreshDocuments(): Promise<void>
}

type StorageErrorState = StorageConnection['error']
type DocumentList = NonNullable<StorageConnection['documents']>

const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again."

function toErrorCode(status: number, code: unknown): StorageErrorCode {
  if (typeof code === 'string' && (STORAGE_ERROR_CODES as readonly string[]).includes(code)) {
    return code as StorageErrorCode
  }
  return status === 429 ? 'rate_limited' : 'storage_error'
}

function errorFromResponse(status: number, body: unknown): NonNullable<StorageErrorState> {
  const raw = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).code : undefined
  const code = toErrorCode(status, raw)
  return { code, message: storageErrorMessage(code) }
}

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_LOCALSTORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(STORAGE_LOCALSTORAGE_KEY, token)
    else window.localStorage.removeItem(STORAGE_LOCALSTORAGE_KEY)
  } catch {
    // Storage can be blocked (private mode, policy); the link then lasts for this page only.
  }
}

function parseDocuments(body: unknown): DocumentList {
  const list = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).documents : undefined
  if (!Array.isArray(list)) return []
  return list
    .filter((d): d is { filename: string; chunks: number } =>
      typeof d === 'object' && d !== null && typeof d.filename === 'string' && typeof d.chunks === 'number')
    .map(d => ({ filename: d.filename, chunks: d.chunks }))
}

type LoadResult =
  | { ok: true; documents: DocumentList }
  | { ok: false; error: NonNullable<StorageErrorState>; forget: boolean }

async function loadDocuments(token: string): Promise<LoadResult> {
  try {
    const response = await fetch('/api/storage/documents', { headers: { [STORAGE_TOKEN_HEADER]: token } })
    const body = await response.json().catch(() => null)
    if (response.ok) return { ok: true, documents: parseDocuments(body) }
    const error = errorFromResponse(response.status, body)
    const forget = response.status === 401 || response.status === 403 || error.code === 'workspace_not_found'
    return { ok: false, error, forget }
  } catch {
    return { ok: false, error: { code: 'storage_error', message: NETWORK_ERROR }, forget: false }
  }
}

export function useStorageConnection(): StorageConnection {
  const [ready, setReady] = useState(false)
  const [available, setAvailable] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DocumentList | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<StorageErrorState>(null)
  const [lastMigration, setLastMigration] = useState<StorageConnection['lastMigration']>(null)
  // Bumped on disconnect so responses that started before it are dropped.
  const generation = useRef(0)

  const applyLoad = useCallback((result: LoadResult) => {
    if (result.ok) {
      setDocuments(result.documents)
      return
    }
    setError(result.error)
    if (result.forget) {
      writeStoredToken(null)
      setToken(null)
      setDocuments(null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const stored = readStoredToken()

    const init = async () => {
      let isAvailable = false
      try {
        const response = await fetch('/api/storage/status', { cache: 'no-store' })
        const body = await response.json().catch(() => null)
        isAvailable = response.ok && body?.available === true
      } catch {
        isAvailable = false
      }
      if (cancelled) return
      setAvailable(isAvailable)

      if (isAvailable && stored) {
        setToken(stored)
        const started = generation.current
        const result = await loadDocuments(stored)
        if (cancelled || started !== generation.current) return
        applyLoad(result)
      }
      if (!cancelled) setReady(true)
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [applyLoad])

  const refreshDocuments = useCallback(async () => {
    if (!available || !token) return
    const started = generation.current
    const result = await loadDocuments(token)
    if (started !== generation.current) return
    applyLoad(result)
  }, [available, token, applyLoad])

  const connect = useCallback(async (connectionString: string, sessionId: string | null): Promise<boolean> => {
    if (!available) {
      setError({ code: 'storage_unavailable', message: storageErrorMessage('storage_unavailable') })
      return false
    }
    setConnecting(true)
    setError(null)
    const started = generation.current
    try {
      const response = await fetch('/api/storage/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionString, sessionId }),
      })
      const body = await response.json().catch(() => null)
      if (started !== generation.current) return false
      const newToken: unknown = body?.token
      if (!response.ok || body?.status !== 'connected' || typeof newToken !== 'string') {
        setError(errorFromResponse(response.status, body))
        return false
      }
      writeStoredToken(newToken)
      setToken(newToken)
      setLastMigration({
        documents: typeof body.migratedDocuments === 'number' ? body.migratedDocuments : 0,
        chunks: typeof body.migratedChunks === 'number' ? body.migratedChunks : 0,
      })
      const result = await loadDocuments(newToken)
      if (started === generation.current) applyLoad(result)
      return true
    } catch {
      if (started === generation.current) setError({ code: 'storage_error', message: NETWORK_ERROR })
      return false
    } finally {
      if (started === generation.current) setConnecting(false)
    }
  }, [available, applyLoad])

  const disconnect = useCallback(() => {
    generation.current += 1
    writeStoredToken(null)
    setToken(null)
    setDocuments(null)
    setError(null)
    setLastMigration(null)
    setConnecting(false)
  }, [])

  const activeToken = available ? token : null
  const requestHeaders = useMemo(() => {
    const headers: Record<string, string> = {}
    if (activeToken) headers[STORAGE_TOKEN_HEADER] = activeToken
    return headers
  }, [activeToken])

  return useMemo(
    () => ({
      ready,
      available,
      connected: activeToken !== null,
      token: activeToken,
      documents,
      connecting,
      error,
      lastMigration,
      requestHeaders,
      connect,
      disconnect,
      refreshDocuments,
    }),
    [ready, available, activeToken, documents, connecting, error, lastMigration, requestHeaders, connect, disconnect, refreshDocuments],
  )
}
