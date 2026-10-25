import { NextRequest, NextResponse } from 'next/server'
import { createWidgetFromSession } from '../../../../lib/database'
import { clientIp, isRateLimited, isWithinLimit, LIMITS } from '../../../../lib/guard'
import { resolveBuilderStore, storageErrorResponse } from '../../../../lib/storage/resolve'
import { isStorageError, safeErrorSummary, StorageError } from '../../../../lib/storage/errors'
import { keyLabel } from '../../../../lib/storage/log'
import {
  isStorageEnabled,
  MAX_WIDGET_TOKEN_V2_LENGTH,
  sealWidgetToken,
  sealWidgetTokenV2,
  type WidgetTokenV2Payload,
} from '../../../../lib/storage/token'
import { normalizeOriginList, ORIGIN_ERROR_MESSAGES, ORIGINS_REQUIRED_MESSAGE } from '../../../../lib/origins'
import { modelErrorResponse, resolveBuilderModel } from '../../../../lib/model/resolve'
import { isModelError } from '../../../../lib/model/shared'
import type { WidgetSettings } from '../../../../lib/storage/types'

// Deflate output varies by a few bytes with the IDs, so the dry run leaves room for that
const DRY_RUN_MARGIN = 64

// Seals the token with stand-in IDs of the real format before anything is created, so an
// embed that cannot fit is refused without leaving an orphan widget behind.
function assertEmbedFits(payload: WidgetTokenV2Payload): void {
  if (sealWidgetTokenV2(payload).length > MAX_WIDGET_TOKEN_V2_LENGTH - DRY_RUN_MARGIN) {
    throw new StorageError('embed_too_large')
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 Widget generation started')
    if (isRateLimited(`generate:${clientIp(request)}`, 10)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    // Resolved before the body is read, so a bad or wrong-purpose token reads and writes nothing
    const resolved = resolveBuilderStore(request)
    if (!resolved.ok) return storageErrorResponse(resolved.error)
    const ctx = resolved.ctx
    const resolvedModel = resolveBuilderModel(request)
    if (!resolvedModel.ok) return modelErrorResponse(resolvedModel.error)
    // Sealed into the embed token only; never echoed in the response
    const model = resolvedModel.model

    const config = await request.json()
    // Field names only: values can hold prompts, and must never reach logs
    console.log('📝 Widget config received, fields:', Object.keys(config ?? {}))

    if (
      !isWithinLimit(config.system_prompt, LIMITS.systemPrompt) ||
      !isWithinLimit(config.role_context, LIMITS.roleContext) ||
      (config.allowed_domains !== undefined &&
        !(Array.isArray(config.allowed_domains) && config.allowed_domains.every((d: unknown) => typeof d === 'string')))
    ) {
      return NextResponse.json({ error: 'Invalid widget configuration' }, { status: 400 })
    }

    let origins: string[] = []
    if (config.allowed_origins !== undefined) {
      const list = normalizeOriginList(config.allowed_origins)
      if (!list.ok) {
        return NextResponse.json({ error: ORIGIN_ERROR_MESSAGES[list.code], code: 'invalid_origin' }, { status: 400 })
      }
      origins = list.origins
    }

    // An owner-model embed spends the owner's credits, so it must name the sites allowed to use it
    if (model && origins.length === 0) {
      return NextResponse.json({ error: ORIGINS_REQUIRED_MESSAGE, code: 'origins_required' }, { status: 400 })
    }
    const modelField = model ? { model } : {}
    
    if (ctx.kind === 'memory' && !config.sessionId) {
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

    const settings: WidgetSettings = {
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
    }

    let result: { widget: object; widgetKey: string; persistent?: true }
    if (ctx.kind === 'postgres') {
      const workspaceId = ctx.workspaceId
      // Postgres createWidget does not check for documents; refuse here with the demo's error body
      if (!(await ctx.store.hasDocuments(workspaceId))) {
        console.error(`❌ Widget refused: no documents in ${ctx.label}`)
        return NextResponse.json(
          { error: 'Failed to generate widget', details: 'Session not found or has no documents' },
          { status: 400 }
        )
      }
      const conn = ctx.connection.normalized
      const useV2 = origins.length > 0 || model !== null
      if (useV2) {
        assertEmbedFits({ source: { kind: 'postgres', conn, workspaceId, widgetId: crypto.randomUUID() }, origins, ...modelField })
      }
      const widget = await ctx.store.createWidget(workspaceId, settings)
      const widgetKey = useV2
        ? sealWidgetTokenV2({ source: { kind: 'postgres', conn, workspaceId, widgetId: widget.id }, origins, ...modelField })
        : sealWidgetToken({ conn, workspaceId, widgetId: widget.id })
      result = { widget: { ...widget, widget_key: widgetKey }, widgetKey, persistent: true }
    } else {
      console.log('🔧 Creating widget from session...')
      // With the server key the list rides in an sbw2_ token and the record is
      // sealed, so the plain widget- key must never leave this route
      // A model is only ever present when the server key is set (resolveBuilderModel checks it)
      const seal = (origins.length > 0 && isStorageEnabled()) || model !== null
      if (seal) {
        const placeholderKey = 'widget-' + crypto.randomUUID().replace(/-/g, '')
        assertEmbedFits({ source: { kind: 'memory', widgetKey: placeholderKey }, origins, ...modelField })
      }
      const created = await createWidgetFromSession(config.sessionId, {
        ...settings,
        ...(origins.length > 0 ? { allowed_origins: origins } : {}),
        ...(seal ? { sealed: true } : {}),
        knowledge_base_id: '' // Will be created by the function
      })
      if (seal) {
        const widgetKey = sealWidgetTokenV2({ source: { kind: 'memory', widgetKey: created.widgetKey }, origins, ...modelField })
        result = { widget: { ...created.widget, widget_key: widgetKey }, widgetKey }
      } else {
        result = created
      }
    }
    
    console.log('✅ Widget created successfully:', keyLabel(result.widgetKey))

    // Generate the embeddable script
    // The builder's own origin is public by definition (the person is using it).
    // VERCEL_URL was the per-deployment URL, which sits behind Vercel login and
    // changes on every deploy, so embeds built from it could never answer.
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin
    
    const scriptUrl = `${baseUrl}/api/widget/script/${result.widgetKey}`
    const embedCode = `<script src="${scriptUrl}" async></script>`
    
    console.log('Widget generated:', {
      widgetKey: keyLabel(result.widgetKey),
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
      ...(result.persistent ? { persistent: true } : {}),
    })
  } catch (error) {
    if (isStorageError(error)) {
      console.error(`Widget generation storage error ${safeErrorSummary(error)}`)
      return storageErrorResponse(error)
    }
    // No provider call happens here; mapped anyway so a ModelError message can never be echoed
    if (isModelError(error)) return modelErrorResponse(error)
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