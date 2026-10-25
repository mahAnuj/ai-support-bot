import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../lib/guard'
import { assertCapabilities, getHealth, searchPassages } from '../../../../lib/connector/client'
import { connectorErrorResponse, resolveBuilderConnector } from '../../../../lib/connector/resolve'
import {
  CONNECTOR_ERROR_STATUS,
  CONNECTOR_LIMITS,
  ConnectorError,
  connectorErrorMessage,
  isConnectorError,
} from '../../../../lib/connector/shared'
import { sealConnectorToken } from '../../../../lib/connector/token'

export const dynamic = 'force-dynamic'

type Stage = 'health' | 'search'

function stageFailure(e: unknown, stage: Stage, label: string): NextResponse {
  // The client only throws ConnectorError; anything else is reported as unreachable, never echoed.
  const err = isConnectorError(e) ? e : new ConnectorError('connector_unreachable')
  console.log(`connector test outcome=${err.code} stage=${stage} ${label}`)
  const message = connectorErrorMessage(err.code, err.httpStatus)
  return NextResponse.json(
    { error: message, code: err.code, details: message, stage },
    { status: CONNECTOR_ERROR_STATUS[err.code] },
  )
}

export async function POST(request: NextRequest) {
  if (isRateLimited(`connector-test:${clientIp(request)}`, 10)) {
    return connectorErrorResponse(new ConnectorError('connector_rate_limited'))
  }

  const resolved = resolveBuilderConnector(request)
  if (!resolved.ok) return connectorErrorResponse(resolved.error)
  const { connector, label } = resolved

  let health
  try {
    health = assertCapabilities(await getHealth(connector))
  } catch (e) {
    return stageFailure(e, 'health', label)
  }

  let passagesReturned: number
  try {
    passagesReturned = (await searchPassages(connector, 'connection test', CONNECTOR_LIMITS.testTopK)).length
  } catch (e) {
    return stageFailure(e, 'search', label)
  }

  let token: string
  try {
    token = sealConnectorToken({ ...connector, answer: health.answer })
  } catch {
    return connectorErrorResponse(new ConnectorError('connector_unavailable'))
  }

  console.log(`connector test outcome=ok ${label}`)
  return NextResponse.json(
    {
      ok: true,
      version: health.version,
      capabilities: health.capabilities,
      answer: health.answer,
      passagesReturned,
      token,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
