import { NextRequest, NextResponse } from 'next/server'
import { getWidgetByKey } from '../../../../../lib/database'
import { clientIp, isRateLimited } from '../../../../../lib/guard'
import { widgetScript } from '../../../../../lib/widget-script'

// Loaded by the one-line embed code on the site owner's pages, once per page
// view, so the limit is higher than for chat.
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  if (isRateLimited(`script:${clientIp(request)}`, 120)) {
    return new NextResponse('// Too many requests', { status: 429 })
  }

  const { key } = await params
  const widget = await getWidgetByKey(key)
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
