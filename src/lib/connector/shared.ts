// Client-safe: no node imports. Imported by both API routes and browser components.
import type { OwnerModelConfig } from '../model/shared'

export const CONNECTOR_LOCALSTORAGE_KEY = 'ai-support-bot.connector'
export const CONNECTOR_API_VERSION = '1'

export const CONNECTOR_HEADERS = {
  keyId: 'X-Connector-Key-Id',
  timestamp: 'X-Connector-Timestamp',
  nonce: 'X-Connector-Nonce',
  signature: 'X-Connector-Signature',
} as const

export const KEY_ID_PATTERN = /^ck_[0-9a-f]{16}$/
export const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,64}$/
export const TIMESTAMP_PATTERN = /^[1-9][0-9]{0,11}$/
export const SIGNATURE_PATTERN = /^v1=[0-9a-f]{64}$/
export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/

export const CONNECTOR_LIMITS = {
  baseUrl: 500,
  connectBodyBytes: 8192,
  documentRequestBytes: 2_097_152,
  passagesPerDocument: 1000,
  passageChars: 1000,
  filenameChars: 255,
  responseBytes: 1_048_576,
  searchTopK: 5,
  testTopK: 1,
  maxTopK: 10,
  answerMessageChars: 20_000,
  passageTextChars: 10_000,
  widgetTitle: 100,
  widgetWelcome: 500,
  maxScriptUrl: 8000,
  skewSeconds: 300,
  nonceRetentionSeconds: 600,
} as const

export const CONNECTOR_TIMEOUTS_MS = { health: 10_000, search: 10_000, documents: 30_000, answer: 30_000 } as const

export type ConnectorOp = keyof typeof CONNECTOR_TIMEOUTS_MS

export interface ConnectorConfig {
  baseUrl: string
  keyId: string
  secret: string
}

export type ConnectorCapability = 'documents' | 'search' | 'answer'

export interface ConnectorHealth {
  version: '1'
  capabilities: ConnectorCapability[]
  answer: boolean
}

export interface ConnectorPassage {
  documentId: string
  filename: string
  text: string
  score: number
}

export interface ConnectorDocument {
  id: string
  filename: string
  contentType: string
  passageCount: number
  createdAt: string
}

export interface DocumentPayload {
  filename: string
  contentType: string
  passages: { index: number; text: string }[]
}

export type AnswerPath = 'backend' | 'owner' | 'demo'

export interface ConnectorWidgetSettings {
  title: string
  welcomeMessage: string
  primaryColor: string
  position: 'bottom-right' | 'bottom-left'
  size: 'small' | 'medium' | 'large'
  systemPrompt?: string
  roleContext?: string
}

export interface WidgetTokenV3Payload {
  connector: ConnectorConfig
  origins: string[]
  answer: boolean
  settings: ConnectorWidgetSettings
  // Only when answer === false.
  model?: OwnerModelConfig
}

export const CONNECTOR_ERROR_CODES = [
  'connector_unavailable', 'connector_rate_limited', 'connector_invalid_request', 'connector_invalid_url',
  'connector_url_too_long', 'connector_https_required', 'connector_address_blocked', 'connector_unreachable',
  'connector_timeout', 'connector_redirect', 'connector_auth_rejected', 'connector_not_found',
  'connector_document_not_found', 'connector_http_error', 'connector_bad_response',
  'connector_version_unsupported', 'connector_capability_missing', 'connector_document_too_large',
  'connector_no_documents', 'connector_token_invalid', 'connector_token_wrong_purpose',
] as const

export type ConnectorErrorCode = typeof CONNECTOR_ERROR_CODES[number]

export const CONNECTOR_ERROR_STATUS: Record<ConnectorErrorCode, number> = {
  connector_unavailable: 503,
  connector_rate_limited: 429,
  connector_invalid_request: 400,
  connector_invalid_url: 400,
  connector_url_too_long: 400,
  connector_https_required: 400,
  connector_address_blocked: 400,
  connector_unreachable: 502,
  connector_timeout: 504,
  connector_redirect: 502,
  connector_auth_rejected: 422,
  connector_not_found: 422,
  connector_document_not_found: 404,
  connector_http_error: 502,
  connector_bad_response: 502,
  connector_version_unsupported: 422,
  connector_capability_missing: 422,
  connector_document_too_large: 413,
  connector_no_documents: 400,
  connector_token_invalid: 401,
  connector_token_wrong_purpose: 403,
}

export const CONNECTOR_ERROR_MESSAGES: Record<ConnectorErrorCode, string> = {
  connector_unavailable: "Connecting a backend isn't available on this deployment.",
  connector_rate_limited: 'Too many attempts from this network. Wait a minute and try again.',
  connector_invalid_request: "That request couldn't be read.",
  connector_invalid_url: "That doesn't look like a base URL. It should look like https://support.example.com.",
  connector_url_too_long: `That address is longer than ${CONNECTOR_LIMITS.baseUrl} characters.`,
  connector_https_required: 'Use an https:// address.',
  connector_address_blocked: "This address isn't allowed.",
  connector_unreachable: "Couldn't reach your backend.",
  connector_timeout: "Your backend didn't answer in time.",
  connector_redirect: 'Your backend answered with a redirect. Use its final address; redirects are not followed.',
  connector_auth_rejected:
    "Your backend refused this app's signature. Check that CONNECTOR_KEYS on your backend has this key id and secret, and that its clock is correct.",
  connector_not_found: "Your backend doesn't have this endpoint. Check the base URL.",
  connector_document_not_found: 'That document is no longer on your backend.',
  connector_http_error: 'Your backend returned an error.',
  connector_bad_response: "Your backend's reply didn't match the connector API.",
  connector_version_unsupported: 'Your backend uses a different connector API version. This app supports version 1.',
  connector_capability_missing: 'Your backend must support documents and search.',
  connector_document_too_large:
    'This document is too large for a backend: at most 1,000 passages of 1,000 characters, and 2 MB per request.',
  connector_no_documents: 'Your backend has no documents yet. Upload at least one, then generate the embed code.',
  connector_token_invalid: "This browser's link to your backend is no longer valid. Connect again.",
  connector_token_wrong_purpose: "This key can't be used here.",
}

export function isConnectorErrorCode(value: unknown): value is ConnectorErrorCode {
  return typeof value === 'string' && (CONNECTOR_ERROR_CODES as readonly string[]).includes(value)
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
}

export function connectorErrorMessage(code: unknown, httpStatus?: unknown): string {
  if (!isConnectorErrorCode(code)) return CONNECTOR_ERROR_MESSAGES.connector_http_error
  if (code === 'connector_http_error' && isHttpStatus(httpStatus)) {
    return `Your backend returned an error (HTTP ${httpStatus}).`
  }
  return CONNECTOR_ERROR_MESSAGES[code]
}

// The server sends `details` as connectorErrorMessage(code, httpStatus); only the status number is taken from it.
export function connectorStatus(details: unknown): number | undefined {
  if (typeof details !== 'string') return undefined
  const match = /^Your backend returned an error \(HTTP (\d{3})\)\.$/.exec(details)
  return match ? Number(match[1]) : undefined
}

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode
  readonly httpStatus?: number

  constructor(code: ConnectorErrorCode, httpStatus?: number) {
    // message is the code itself so an accidental error.message echo leaks nothing.
    super(code)
    Object.setPrototypeOf(this, new.target.prototype)
    this.name = 'ConnectorError'
    this.code = code
    if (code === 'connector_http_error' && isHttpStatus(httpStatus)) this.httpStatus = httpStatus
  }
}

export function isConnectorError(e: unknown): e is ConnectorError {
  return e instanceof ConnectorError
}
