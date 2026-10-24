import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../../lib/guard'
import { widgetScript } from '../../../../../lib/widget-script'
import { resolveWidget } from '../../../../../lib/storage/resolve'

// Loaded by the one-line embed code on the site owner's pages, once per page
// view, so the limit is higher than for chat.
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  if (isRateLimited(`script:${clientIp(request)}`, 120)) {
    return new NextResponse('// Too many requests', { status: 429 })
  }

  const { key } = await params
  const resolved = await resolveWidget(key)
  if (!resolved.ok && resolved.status === 503) {
    return new NextResponse('// Widget unavailable', {
      status: 503,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  if (!resolved.ok && resolved.status === 403) {
    return new NextResponse('// This widget key cannot be used here', {
      status: 403,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    })
  }
  const widget = resolved.ok ? resolved.ctx.widget : null
  if (!widget || !widget.is_active) {
    return new NextResponse('// Widget not found', {
      status: 404,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    })
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin
  return new NextResponse(widgetScript(widget, baseUrl), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // Widgets live in server memory and can disappear; never cache a copy
      'Cache-Control': 'no-store',
    },
  })
}
