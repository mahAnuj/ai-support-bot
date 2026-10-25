// Server-only: the builder's connector comes from an sbc1_ token in x-storage-token and nothing else.
import { NextResponse } from 'next/server'
import { STORAGE_TOKEN_HEADER } from '../storage/errors'
import { isBuilderTokenShape, isModelTokenShape, isStorageEnabled, isWidgetTokenShape } from '../storage/token'
import { checkConnectorBaseUrl } from './client'
import { connectorLabel } from './log'
import {
  CONNECTOR_ERROR_STATUS,
  ConnectorError,
  connectorErrorMessage,
  type ConnectorConfig,
  type ConnectorErrorCode,
} from './shared'
import { openConnectorToken } from './token'

export type ConnectorResolution =
  | { ok: true; connector: ConnectorConfig; answer: boolean; label: string }
  | { ok: false; error: ConnectorError }

function connectorError(code: ConnectorErrorCode): ConnectorResolution {
  return { ok: false, error: new ConnectorError(code) }
}

// Sync and I/O-free. Wrong-purpose shapes are refused before anything is decrypted.
export function openConnectorHeader(header: string): ConnectorResolution {
  if (!isStorageEnabled()) return connectorError('connector_unavailable')
  if (isWidgetTokenShape(header) || isModelTokenShape(header) || isBuilderTokenShape(header)) {
    return connectorError('connector_token_wrong_purpose')
  }

  const payload = openConnectorToken(header)
  if (!payload) return connectorError('connector_token_invalid')

  // The live private-host policy applies to tokens issued under an older one.
  const checked = checkConnectorBaseUrl(payload.baseUrl)
  if (!checked.ok) return connectorError(checked.code)

  const { baseUrl, keyId, secret, answer } = payload
  return { ok: true, connector: { baseUrl, keyId, secret }, answer, label: connectorLabel(baseUrl) }
}

export function resolveBuilderConnector(request: Request): ConnectorResolution {
  const header = request.headers.get(STORAGE_TOKEN_HEADER)
  if (header === null) return connectorError('connector_token_invalid')
  return openConnectorHeader(header)
}

export function connectorErrorResponse(err: ConnectorError): NextResponse {
  const message = connectorErrorMessage(err.code, err.httpStatus)
  return NextResponse.json({ error: message, code: err.code, details: message }, { status: CONNECTOR_ERROR_STATUS[err.code] })
}
