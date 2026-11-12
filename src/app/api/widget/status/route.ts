import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited, widgetCorsHeaders, widgetOriginAllowed } from '../../../../lib/guard'
import { getLogSettings } from '../../../../lib/storage/conversation-log'
import { resolveWidget } from '../../../../lib/storage/resolve'

// What the widget must tell the visitor before they type. Today one fact:
// whether the owner keeps a conversation log, so the widget can show the
// notice. Only a database-backed widget can keep one. The widget asks once,
// when it is first opened; any failure answers "not logging", and the chat
// route records nothing unless the widget says it showed the notice.
const NOT_LOGGING = { logging: false }
const OPEN_CORS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
}

export async function POST(request: NextRequest) {
  if (isRateLimited(`widget-status:${clientIp(request)}`, 30)) return new NextResponse(JSON.stringify(NOT_LOGGING), { status: 429, headers: OPEN_CORS })
  let widgetKey: unknown
  try {
    widgetKey = (await request.json())?.widgetKey
  } catch {
    return new NextResponse(JSON.stringify(NOT_LOGGING), { status: 400, headers: OPEN_CORS })
  }
  const resolved = await resolveWidget(widgetKey)
  if (!resolved.ok) return new NextResponse(JSON.stringify(NOT_LOGGING), { status: 404, headers: OPEN_CORS })
  const origin = request.headers.get('origin')
  const cors = { ...widgetCorsHeaders(resolved.ctx.access, origin), 'Cache-Control': 'no-store' }
  if (!widgetOriginAllowed(resolved.ctx.access, origin)) return new NextResponse(JSON.stringify(NOT_LOGGING), { status: 403, headers: cors })
  if (resolved.ctx.kind === 'connector' || !resolved.ctx.database) return new NextResponse(JSON.stringify(NOT_LOGGING), { headers: cors })
  try {
    const { connection, workspaceId } = resolved.ctx.database
    const settings = await getLogSettings(connection, workspaceId)
    return new NextResponse(JSON.stringify({ logging: settings.available && settings.enabled }), { headers: cors })
  } catch {
    return new NextResponse(JSON.stringify(NOT_LOGGING), { headers: cors })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: OPEN_CORS })
}
