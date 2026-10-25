import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../lib/guard'
import { assertCapabilities, checkConnectorBaseUrl, getHealthUnsigned } from '../../../../lib/connector/client'
import { connectorLabel } from '../../../../lib/connector/log'
import { connectorErrorResponse } from '../../../../lib/connector/resolve'
import {
  CONNECTOR_LIMITS,
  ConnectorError,
  isConnectorError,
  type ConnectorErrorCode,
} from '../../../../lib/connector/shared'
import { generateKeyId, generateSecret } from '../../../../lib/connector/signing'
import { sealConnectorToken } from '../../../../lib/connector/token'
import { STORAGE_TOKEN_HEADER } from '../../../../lib/storage/errors'
import { isModelTokenShape, isStorageEnabled, isWidgetTokenShape } from '../../../../lib/storage/token'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = CONNECTOR_LIMITS.connectBodyBytes

// Reads at most MAX_BODY_BYTES from the stream, so an oversized body is never buffered or parsed.
async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  if (!request.body) return null

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks))
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function fail(error: ConnectorErrorCode | ConnectorError, label?: string): NextResponse {
  const err = typeof error === 'string' ? new ConnectorError(error) : error
  console.log(`connector connect outcome=${err.code}${label ? ` ${label}` : ''}`)
  return connectorErrorResponse(err)
}

export async function POST(request: NextRequest) {
  if (isRateLimited(`connector-connect:${clientIp(request)}`, 5)) return fail('connector_rate_limited')

  const header = request.headers.get(STORAGE_TOKEN_HEADER)
  if (isWidgetTokenShape(header) || isModelTokenShape(header)) return fail('connector_token_wrong_purpose')
  if (!isStorageEnabled()) return fail('connector_unavailable')

  const body = await readBody(request)
  if (!body || typeof body.baseUrl !== 'string') return fail('connector_invalid_request')

  const checked = checkConnectorBaseUrl(body.baseUrl.trim())
  if (!checked.ok) return fail(checked.code)
  const baseUrl = checked.baseUrl
  const label = connectorLabel(baseUrl)

  let health
  try {
    health = assertCapabilities(await getHealthUnsigned(baseUrl))
  } catch (e) {
    // The client only throws ConnectorError; anything else is reported as unreachable, never echoed.
    return fail(isConnectorError(e) ? e : 'connector_unreachable', label)
  }

  const keyId = generateKeyId()
  const secret = generateSecret()
  let token: string
  try {
    token = sealConnectorToken({ baseUrl, keyId, secret, answer: health.answer })
  } catch {
    return fail('connector_unavailable', label)
  }

  console.log(`connector connect outcome=ok ${label}`)
  // The only response that ever carries the secret.
  return NextResponse.json(
    {
      status: 'pending',
      token,
      keyId,
      secret,
      host: new URL(baseUrl).host,
      version: health.version,
      capabilities: health.capabilities,
      answer: health.answer,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
