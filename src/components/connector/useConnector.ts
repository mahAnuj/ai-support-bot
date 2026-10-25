'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CONNECTOR_LIMITS,
  CONNECTOR_LOCALSTORAGE_KEY,
  KEY_ID_PATTERN,
  SECRET_PATTERN,
  connectorErrorMessage,
  connectorStatus,
  isConnectorErrorCode,
  type ConnectorErrorCode,
} from '@/lib/connector/shared'
import { STORAGE_TOKEN_HEADER } from '@/lib/storage/errors'

export interface ConnectorInfo {
  host: string
  keyId: string
  version: string
  capabilities: string[]
  answer: boolean
}

export interface ConnectorPending extends ConnectorInfo {
  token: string
  secret: string
}

export interface ConnectorDocumentRow {
  id: string
  filename: string
  passageCount: number
  createdAt: string
}

export interface ConnectorUiError {
  // null when the request never got an answer from this server
  code: ConnectorErrorCode | null
  message: string
}

export type ConnectorTestResult =
  | { ok: true; passagesReturned: number }
  | { ok: false; stage: 'health' | 'search' | null; message: string }

export type ConnectorBusy = 'connect' | 'test' | 'documents' | 'delete' | null

// 'unconfigured': the backend refused the new key before any test passed, which is expected until CONNECTOR_KEYS is set.
export type ConnectorDocumentsStatus = 'idle' | 'loading' | 'loaded' | 'failed' | 'unconfigured'

export interface Connector {
  ready: boolean
  available: boolean
  connected: boolean
  token: string | null
  info: ConnectorInfo | null
  pending: ConnectorPending | null
  documents: ConnectorDocumentRow[] | null
  documentsStatus: ConnectorDocumentsStatus
  documentsError: string | null
  busy: ConnectorBusy
  error: ConnectorUiError | null
  testResult: ConnectorTestResult | null
  requestHeaders: Record<string, string>
  connect(baseUrl: string): Promise<boolean>
  confirmSaved(): void
  cancelPending(): void
  test(): Promise<void>
  refreshDocuments(): Promise<void>
  deleteDocument(id: string): Promise<boolean>
  disconnect(): void
}

interface StoredConnector extends ConnectorInfo {
  token: string
}

const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again."
const TOKEN_PREFIX = 'sbc1_'

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function parseInfo(raw: Record<string, unknown>): ConnectorInfo | null {
  const { host, keyId, version, capabilities, answer } = raw
  if (typeof host !== 'string' || host === '') return null
  if (typeof keyId !== 'string' || !KEY_ID_PATTERN.test(keyId)) return null
  if (typeof version !== 'string' || typeof answer !== 'boolean') return null
  if (!Array.isArray(capabilities) || !capabilities.every(c => typeof c === 'string')) return null
  return { host, keyId, version, capabilities: [...capabilities], answer }
}

function parseStored(raw: unknown): StoredConnector | null {
  const fields = asRecord(raw)
  const info = parseInfo(fields)
  const token = fields.token
  if (!info || typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) return null
  return { token, ...info }
}

function readStored(): StoredConnector | null {
  try {
    const raw = window.localStorage.getItem(CONNECTOR_LOCALSTORAGE_KEY)
    return raw ? parseStored(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

// Only the encrypted token and display fields are written; the fields are listed so a secret can't ride along.
function writeStored(token: string | null, info: ConnectorInfo | null): void {
  try {
    if (token && info) {
      const value: StoredConnector = {
        token,
        host: info.host,
        keyId: info.keyId,
        version: info.version,
        capabilities: info.capabilities,
        answer: info.answer,
      }
      window.localStorage.setItem(CONNECTOR_LOCALSTORAGE_KEY, JSON.stringify(value))
    } else {
      window.localStorage.removeItem(CONNECTOR_LOCALSTORAGE_KEY)
    }
  } catch {
    // Storage can be blocked (private mode, policy); the link then lasts for this page only.
  }
}

function errorFromResponse(status: number, body: unknown): ConnectorUiError {
  const fields = asRecord(body)
  if (isConnectorErrorCode(fields.code)) {
    return { code: fields.code, message: connectorErrorMessage(fields.code, connectorStatus(fields.details)) }
  }
  if (status === 429) return { code: 'connector_rate_limited', message: connectorErrorMessage('connector_rate_limited') }
  if (status === 503) return { code: 'connector_unavailable', message: connectorErrorMessage('connector_unavailable') }
  if (status === 401) return { code: 'connector_token_invalid', message: connectorErrorMessage('connector_token_invalid') }
  if (status === 403) return { code: 'connector_token_wrong_purpose', message: connectorErrorMessage('connector_token_wrong_purpose') }
  return { code: null, message: `Something went wrong (status ${status}). Try again shortly.` }
}

function parseDocuments(body: unknown): ConnectorDocumentRow[] {
  const list = asRecord(body).documents
  if (!Array.isArray(list)) return []
  return list
    .map(asRecord)
    .filter(d => typeof d.id === 'string' && typeof d.filename === 'string' && typeof d.passageCount === 'number')
    .map(d => ({
      id: d.id as string,
      filename: d.filename as string,
      passageCount: d.passageCount as number,
      createdAt: typeof d.createdAt === 'string' ? d.createdAt : '',
    }))
}

function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403
}

export function useConnector(available: boolean, ready: boolean): Connector {
  const [loaded, setLoaded] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [info, setInfo] = useState<ConnectorInfo | null>(null)
  // The only place the signing secret lives in the browser; never persisted.
  const [pending, setPending] = useState<ConnectorPending | null>(null)
  const [documents, setDocuments] = useState<ConnectorDocumentRow[] | null>(null)
  const [documentsStatus, setDocumentsStatus] = useState<ConnectorDocumentsStatus>('idle')
  const [documentsError, setDocumentsError] = useState<string | null>(null)
  const [busy, setBusy] = useState<ConnectorBusy>(null)
  const [error, setError] = useState<ConnectorUiError | null>(null)
  const [testResult, setTestResult] = useState<ConnectorTestResult | null>(null)
  // Bumped on disconnect and cancel so responses that started before them are dropped.
  const generation = useRef(0)
  // Only the latest list request may set the list.
  const listRequest = useRef(0)
  // False from "I've saved it" until a test or list call is accepted by the backend.
  const keyAccepted = useRef(true)

  const forget = useCallback(() => {
    generation.current += 1
    writeStored(null, null)
    setToken(null)
    setInfo(null)
    setDocuments(null)
    setDocumentsStatus('idle')
    setDocumentsError(null)
    setTestResult(null)
    setBusy(null)
  }, [])

  const loadDocuments = useCallback(async (forToken: string) => {
    const started = generation.current
    listRequest.current += 1
    const request = listRequest.current
    const current = () => started === generation.current && request === listRequest.current
    setDocumentsStatus('loading')
    setDocumentsError(null)
    try {
      const response = await fetch('/api/connector/documents', {
        headers: { [STORAGE_TOKEN_HEADER]: forToken },
        cache: 'no-store',
      })
      const body = await response.json().catch(() => null)
      if (!current()) return
      if (response.ok) {
        keyAccepted.current = true
        setDocuments(parseDocuments(body))
        setDocumentsStatus('loaded')
        return
      }
      const failure = errorFromResponse(response.status, body)
      if (isAuthFailure(response.status)) {
        forget()
        setError(failure)
        return
      }
      if (failure.code === 'connector_auth_rejected' && !keyAccepted.current) {
        setDocumentsStatus('unconfigured')
        return
      }
      setDocumentsStatus('failed')
      setDocumentsError(failure.message)
    } catch {
      if (!current()) return
      setDocumentsStatus('failed')
      setDocumentsError(NETWORK_ERROR)
    }
  }, [forget])

  useEffect(() => {
    if (!ready || loaded) return
    setLoaded(true)
    const stored = readStored()
    if (!stored) {
      // A malformed entry is dropped rather than kept around.
      writeStored(null, null)
      return
    }
    if (!available) return
    const { token: storedToken, ...storedInfo } = stored
    keyAccepted.current = true
    setToken(storedToken)
    setInfo(storedInfo)
    void loadDocuments(storedToken)
  }, [ready, available, loaded, loadDocuments])

  const activeToken = available ? token : null

  const refreshDocuments = useCallback(async () => {
    if (!activeToken) return
    await loadDocuments(activeToken)
  }, [activeToken, loadDocuments])

  const connect = useCallback(async (baseUrl: string): Promise<boolean> => {
    if (!available) {
      setError({ code: 'connector_unavailable', message: connectorErrorMessage('connector_unavailable') })
      return false
    }
    const trimmed = baseUrl.trim()
    if (trimmed.length > CONNECTOR_LIMITS.baseUrl) {
      setError({ code: 'connector_url_too_long', message: connectorErrorMessage('connector_url_too_long') })
      return false
    }
    setBusy('connect')
    setError(null)
    setTestResult(null)
    const started = generation.current
    try {
      const response = await fetch('/api/connector/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: trimmed }),
        cache: 'no-store',
      })
      const body = asRecord(await response.json().catch(() => null))
      if (started !== generation.current) return false
      const parsedInfo = response.ok ? parseInfo(body) : null
      const newToken = body.token
      const secret = body.secret
      if (
        !parsedInfo ||
        body.status !== 'pending' ||
        typeof newToken !== 'string' ||
        !newToken.startsWith(TOKEN_PREFIX) ||
        typeof secret !== 'string' ||
        !SECRET_PATTERN.test(secret)
      ) {
        setError(response.ok ? { code: 'connector_bad_response', message: "The server's reply couldn't be read. Try again." } : errorFromResponse(response.status, body))
        return false
      }
      setPending({ ...parsedInfo, token: newToken, secret })
      return true
    } catch {
      if (started === generation.current) setError({ code: null, message: NETWORK_ERROR })
      return false
    } finally {
      if (started === generation.current) setBusy(null)
    }
  }, [available])

  const confirmSaved = useCallback(() => {
    if (!pending) return
    const { token: newToken, secret: _secret, ...newInfo } = pending
    void _secret
    setPending(null)
    keyAccepted.current = false
    writeStored(newToken, newInfo)
    setToken(newToken)
    setInfo(newInfo)
    setDocuments(null)
    setError(null)
    setTestResult(null)
    void loadDocuments(newToken)
  }, [pending, loadDocuments])

  const cancelPending = useCallback(() => {
    generation.current += 1
    setPending(null)
    setError(null)
    setBusy(null)
  }, [])

  const test = useCallback(async () => {
    if (!activeToken || !info) return
    setBusy('test')
    setError(null)
    setTestResult(null)
    const started = generation.current
    try {
      const response = await fetch('/api/connector/test', {
        method: 'POST',
        headers: { [STORAGE_TOKEN_HEADER]: activeToken },
        cache: 'no-store',
      })
      const body = asRecord(await response.json().catch(() => null))
      if (started !== generation.current) return
      const newToken = body.token
      if (response.ok && body.ok === true && typeof newToken === 'string' && newToken.startsWith(TOKEN_PREFIX)) {
        const nextInfo: ConnectorInfo = {
          ...info,
          version: typeof body.version === 'string' ? body.version : info.version,
          capabilities:
            Array.isArray(body.capabilities) && body.capabilities.every(c => typeof c === 'string')
              ? [...(body.capabilities as string[])]
              : info.capabilities,
          answer: typeof body.answer === 'boolean' ? body.answer : info.answer,
        }
        writeStored(newToken, nextInfo)
        setToken(newToken)
        setInfo(nextInfo)
        setTestResult({ ok: true, passagesReturned: typeof body.passagesReturned === 'number' ? body.passagesReturned : 0 })
        keyAccepted.current = true
        void loadDocuments(newToken)
        return
      }
      const failure = response.ok
        ? { code: 'connector_bad_response' as const, message: "The server's reply couldn't be read. Try again." }
        : errorFromResponse(response.status, body)
      const stage = body.stage === 'health' || body.stage === 'search' ? body.stage : null
      setTestResult({ ok: false, stage, message: failure.message })
      if (isAuthFailure(response.status)) {
        forget()
        setError(failure)
      }
    } catch {
      if (started === generation.current) setTestResult({ ok: false, stage: null, message: NETWORK_ERROR })
    } finally {
      if (started === generation.current) setBusy(null)
    }
  }, [activeToken, info, forget, loadDocuments])

  const deleteDocument = useCallback(async (id: string): Promise<boolean> => {
    if (!activeToken) return false
    setBusy('delete')
    setError(null)
    const started = generation.current
    try {
      const response = await fetch(`/api/connector/documents?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { [STORAGE_TOKEN_HEADER]: activeToken },
        cache: 'no-store',
      })
      const body = await response.json().catch(() => null)
      if (started !== generation.current) return false
      if (response.ok) {
        setDocuments(list => (list ? list.filter(d => d.id !== id) : list))
        return true
      }
      const failure = errorFromResponse(response.status, body)
      setError(failure)
      if (isAuthFailure(response.status)) forget()
      // Already gone on the backend: show the list as it is now.
      else if (failure.code === 'connector_document_not_found') void loadDocuments(activeToken)
      return false
    } catch {
      if (started === generation.current) setError({ code: null, message: NETWORK_ERROR })
      return false
    } finally {
      if (started === generation.current) setBusy(null)
    }
  }, [activeToken, forget, loadDocuments])

  const disconnect = useCallback(() => {
    forget()
    setPending(null)
    setError(null)
  }, [forget])

  const connected = activeToken !== null && info !== null
  const requestHeaders = useMemo(() => {
    const headers: Record<string, string> = {}
    if (connected && activeToken) headers[STORAGE_TOKEN_HEADER] = activeToken
    return headers
  }, [connected, activeToken])

  return useMemo(
    () => ({
      ready: ready && loaded,
      available,
      connected,
      token: connected ? activeToken : null,
      info: connected ? info : null,
      pending: available ? pending : null,
      documents: connected ? documents : null,
      documentsStatus: connected ? documentsStatus : 'idle',
      documentsError: connected ? documentsError : null,
      busy,
      error,
      testResult,
      requestHeaders,
      connect,
      confirmSaved,
      cancelPending,
      test,
      refreshDocuments,
      deleteDocument,
      disconnect,
    }),
    [ready, loaded, available, connected, activeToken, info, pending, documents, documentsStatus, documentsError, busy, error, testResult, requestHeaders, connect, confirmSaved, cancelPending, test, refreshDocuments, deleteDocument, disconnect],
  )
}
