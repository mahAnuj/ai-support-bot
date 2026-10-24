import { NextRequest, NextResponse } from 'next/server'
import { createWidgetFromSession } from '../../../../lib/database'
import { clientIp, isRateLimited, isWithinLimit, LIMITS } from '../../../../lib/guard'

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 Widget generation started')
    if (isRateLimited(`generate:${clientIp(request)}`, 10)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const config = await request.json()
    console.log('📝 Widget config received:', config)

    if (
      !isWithinLimit(config.system_prompt, LIMITS.systemPrompt) ||
      !isWithinLimit(config.role_context, LIMITS.roleContext) ||
      (config.allowed_domains !== undefined &&
        !(Array.isArray(config.allowed_domains) && config.allowed_domains.every((d: unknown) => typeof d === 'string')))
    ) {
      return NextResponse.json({ error: 'Invalid widget configuration' }, { status: 400 })
    }
    
    if (!config.sessionId) {
      console.error('❌ Missing session ID')
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      )
    }

    if (!config.name && !config.title) {
      console.error('❌ Missing widget name/title')
      return NextResponse.json(
        { error: 'Widget name or title is required' },
        { status: 400 }
      )
    }

    console.log('🔧 Creating widget from session...')
    // Create widget from session
    const result = await createWidgetFromSession(config.sessionId, {
      name: config.name || config.title || 'Support Widget',
      title: config.title || 'AI Support Assistant',
      welcome_message: config.welcome_message || 'Hi! How can I help you today?',
      primary_color: config.primary_color || '#3B82F6',
      position: config.position || 'bottom-right',
      size: config.size || 'medium',
      allowed_domains: config.allowed_domains || [],
      business_name: config.business_name || 'Demo Company',
      system_prompt: config.system_prompt,
      role_context: config.role_context,
      knowledge_base_id: '' // Will be created by the function
    })
    
    console.log('✅ Widget created successfully:', result.widgetKey)

    // Generate the embeddable script
    // The builder's own origin is public by definition (the person is using it).
    // VERCEL_URL was the per-deployment URL, which sits behind Vercel login and
    // changes on every deploy, so embeds built from it could never answer.
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin
    
    const scriptUrl = `${baseUrl}/api/widget/script/${result.widgetKey}`
    const embedCode = `<script src="${scriptUrl}" async></script>`
    
    console.log('Widget generated:', {
      widgetKey: result.widgetKey,
      baseUrl,
      hasEmbedCode: !!embedCode,
      embedCodeLength: embedCode.length
    })
    
    return NextResponse.json({
      success: true,
      widget: result.widget,
      widgetKey: result.widgetKey,
      embedCode,
      scriptUrl,
    })
  } catch (error) {
    console.error('Widget generation error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to generate widget',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
} 