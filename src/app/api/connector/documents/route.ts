import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../lib/guard'
import { deleteDocument, listDocuments } from '../../../../lib/connector/client'
import { connectorErrorResponse, resolveBuilderConnector } from '../../../../lib/connector/resolve'
import { ConnectorError, DOCUMENT_ID_PATTERN, isConnectorError } from '../../../../lib/connector/shared'

export const dynamic = 'force-dynamic'

function rateLimited(request: NextRequest): boolean {
  return isRateLimited(`connector-docs:${clientIp(request)}`, 30)
}

// The client only throws ConnectorError; anything else is reported as unreachable, never echoed.
function failure(e: unknown): NextResponse {
  return connectorErrorResponse(isConnectorError(e) ? e : new ConnectorError('connector_unreachable'))
}

export async function GET(request: NextRequest) {
  if (rateLimited(request)) return connectorErrorResponse(new ConnectorError('connector_rate_limited'))

  const resolved = resolveBuilderConnector(request)
  if (!resolved.ok) return connectorErrorResponse(resolved.error)

  try {
    const documents = await listDocuments(resolved.connector)
    return NextResponse.json({
      documents: documents.map(({ id, filename, passageCount, createdAt }) => ({ id, filename, passageCount, createdAt })),
    })
  } catch (e) {
    return failure(e)
  }
}

export async function DELETE(request: NextRequest) {
  if (rateLimited(request)) return connectorErrorResponse(new ConnectorError('connector_rate_limited'))

  const resolved = resolveBuilderConnector(request)
  if (!resolved.ok) return connectorErrorResponse(resolved.error)

  const id = request.nextUrl.searchParams.get('id')
  if (id === null || !DOCUMENT_ID_PATTERN.test(id)) {
    return connectorErrorResponse(new ConnectorError('connector_invalid_request'))
  }

  try {
    await deleteDocument(resolved.connector, id)
    return NextResponse.json({ deleted: true })
  } catch (e) {
    return failure(e)
  }
}
