import { NextRequest, NextResponse, after } from 'next/server'
import { recordTurn } from '../../../../lib/storage/conversation-log'
import { recordDailyStat, type StatEvent } from '../../../../lib/storage/daily-stats'
import type { ParsedConnection } from '../../../../lib/storage/connection'
import { DEFAULT_WIDGET_SYSTEM_PROMPT, chatErrorCode, generateResponse, widgetSystemPrompt } from '../../../../lib/llm'
import { demoProvider, ownerProvider } from '../../../../lib/model/provider'
import { isModelError } from '../../../../lib/model/shared'
import { getCachedEmbedding } from '../../../../lib/rag'
import { matchScore, MIN_SIMILARITY } from '../../../../lib/embeddings'
import { clientIp, isRateLimited, LIMITS, widgetCorsHeaders, widgetOriginAllowed } from '../../../../lib/guard'
import { resolveWidget } from '../../../../lib/storage/resolve'
import { claimSharedModelQuestion, type ClaimResult } from '../../../../lib/shared-model-cap'
import { fingerprint } from '../../../../lib/storage/log'
import { retrievalLog } from '../../../../lib/storage/log'
import { safeErrorSummary } from '../../../../lib/storage/errors'
import { answerWithConnector } from '../../../../lib/connector/answer'
import { isConnectorError } from '../../../../lib/connector/shared'
import type { VectorSearchResult } from '../../../../types/database'

const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Visitors get the answer, not the retrieval internals: source file names
// (a client's could be "pricing-internal-2026.md") and the match score are
// computed and logged here but never sent to the widget, which never showed
// them. The builder preview, which the owner uses, still gets both.
function forVisitor(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return body
  const { sources, confidence, ...rest } = body as Record<string, unknown>
  return rest
}

function corsJson(body: unknown, status: number, headers: Record<string, string> = CORS_HEADERS) {
  body = forVisitor(body)
  return new NextResponse(JSON.stringify(body), { status, headers })
}


// A persistent widget whose database cannot be read must not answer without its documents.
const UNAVAILABLE_BODY = {
  error: 'Widget unavailable',
  message: 'Sorry, I encountered an error. Please try again.',
  isEnhanced: false,
  sessionId: 'error-session',
}

// The bot used up today's questions on the shared demo model (shared-model-cap.ts).
const DAILY_LIMIT_MESSAGE = "This assistant has answered all the questions it can for today. Please try again tomorrow."
const dailyLimitBody = (cap: number) => ({ error: 'Daily limit reached', code: 'daily_limit', message: DAILY_LIMIT_MESSAGE, limit: cap })

// Runs after the reply is sent; outside a request scope (tests, scripts) it runs at once.
function later(task: () => Promise<unknown>) {
  const run = () => task().then(() => undefined)
  try { after(run) } catch { void run() }
}

export async function POST(request: NextRequest) {
  // Before the widget is resolved its policy is unknown, so early errors keep `*`.
  let cors = CORS_HEADERS
  // A database-backed widget's daily counts (src/lib/storage/daily-stats.ts).
  let statsDb: { connection: ParsedConnection; workspaceId: string } | undefined
  const countReply = (event: StatEvent) => {
    const db = statsDb
    if (db) later(() => recordDailyStat(db.connection, db.workspaceId, event))
  }
  try {
    console.log('🔥 WIDGET CHAT API CALLED')
    if (isRateLimited(`widget:${clientIp(request)}`, 20)) {
      return corsJson({ error: 'Too many requests' }, 429)
    }

    const { message, widgetKey, sessionId, chatId, logNotice } = await request.json()

    if (typeof message === 'string' && message.length > LIMITS.message) {
      return corsJson({ error: 'Message too long' }, 400)
    }
    
    if (!message || typeof message !== 'string') {
      return new NextResponse(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    if (!widgetKey) {
      return new NextResponse(JSON.stringify({ error: 'Widget key is required' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    const resolved = await resolveWidget(widgetKey)
    if (!resolved.ok && resolved.status === 403) {
      return corsJson({ error: 'This widget key cannot be used here' }, 403)
    }
    if (!resolved.ok && resolved.status === 503) {
      console.error('Widget chat storage unavailable:', resolved.code)
      return corsJson(UNAVAILABLE_BODY, 503)
    }
    if (!resolved.ok) {
      return new NextResponse(JSON.stringify({ error: 'Widget not found' }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    const ctx = resolved.ctx
    if (ctx.kind !== 'connector' && ctx.database) statsDb = ctx.database
    const origin = request.headers.get('origin')
    cors = widgetCorsHeaders(ctx.access, origin)

    if (!widgetOriginAllowed(ctx.access, origin)) {
      return corsJson({ error: 'This widget is not enabled for this site', code: 'origin_not_allowed' }, 403, cors)
    }

    console.log('Widget Chat API - Widget found:', ctx.label)

    const widgetBot = `widget:${fingerprint(String(widgetKey))}`
    const refuseAtCap = (claim: ClaimResult) => {
      if (claim.allowed) return null
      console.warn(`Widget chat shared model daily limit reached ${ctx.label}`)
      return corsJson(dailyLimitBody(claim.cap), 429, cors)
    }

    if (ctx.kind === 'connector') {
      // Neither the owner's backend nor the owner's model answers: the shared model does, within its daily cap.
      if (!ctx.answer && !ctx.model) {
        const refused = refuseAtCap(await claimSharedModelQuestion({ id: widgetBot }))
        if (refused) return refused
      }
      // A backend widget answers from its backend or not at all: any failure is a 503, never a Groq answer.
      try {
        const result = await answerWithConnector({
          connector: ctx.connector,
          answer: ctx.answer,
          model: ctx.answer ? null : ctx.model,
          question: message,
          systemPrompt: ctx.settings.systemPrompt,
          roleContext: ctx.settings.roleContext,
          defaultSystemPrompt: DEFAULT_WIDGET_SYSTEM_PROMPT,
          audience: 'visitor',
        })
        return corsJson({
          message: result.message,
          confidence: result.confidence,
          sources: result.sources,
          isEnhanced: result.isEnhanced,
          sessionId: sessionId || 'widget-session',
          widgetKey
        }, 200, cors)
      } catch (error) {
        const code = isConnectorError(error) ? error.code : chatErrorCode(error)
        console.error(`Widget chat connector error code=${code}`)
        return corsJson(UNAVAILABLE_BODY, 503, cors)
      }
    }

    const { store, widget, kind, label, model } = ctx
    // The shared demo model's daily cap, counted while documents are searched.
    const sharedClaim = model ? null : claimSharedModelQuestion(ctx.database
      ? { id: `ws:${ctx.database.connection.fingerprint}:${ctx.database.workspaceId}`, database: ctx.database }
      : { id: widgetBot })
    
    let ragResult = null
    let isEnhanced = false
    let confidence = 0 // Match score; stays 0 when no passage is used
    
    let hasDocuments: boolean
    try {
      hasDocuments = await store.widgetHasDocuments(widget)
    } catch (error) {
      if (kind === 'memory') throw error
      console.error('Widget chat storage error:', safeErrorSummary(error))
      countReply({ failure: true })
      return corsJson(UNAVAILABLE_BODY, 503, cors)
    }

    if (hasDocuments) {
      try {
        // Generate embedding for the query
        const queryEmbedding = await getCachedEmbedding(message)
        
        // Query the RAG system for relevant context
        const relevantChunks: VectorSearchResult[] = await store.searchWidgetChunks(widget, {
          queryEmbedding,
          threshold: MIN_SIMILARITY,
          maxResults: 5
        })
        
        retrievalLog(kind, 'widget', relevantChunks, label)
        console.log('Widget Chat API - RAG result:', {
          relevantChunks: relevantChunks.length
        })
        
        // Create context from relevant chunks
        const maxContextLength = 2000
        let context = ''
        const usedSources = new Set<string>()
        
        for (const chunk of relevantChunks) {
          const addition = `${chunk.content}\n\n`
          
          if (context.length + addition.length > maxContextLength) {
            const remainingSpace = maxContextLength - context.length
            if (remainingSpace > 100) {
              context += chunk.content.substring(0, remainingSpace - 10) + '...\n\n'
            }
            break
          }
          
          context += addition
          usedSources.add(chunk.filename)
        }
        
        const calculatedConfidence = matchScore(relevantChunks.map((chunk) => chunk.similarity))
        
        ragResult = {
          context: context.trim(),
          sources: Array.from(usedSources),
          relevantChunks,
          confidence: calculatedConfidence
        }
        
        isEnhanced = context.length > 0
        
        if (isEnhanced) {
          confidence = calculatedConfidence
        }
        
      } catch (error) {
        if (kind === 'postgres') {
          console.error('Widget chat storage error:', safeErrorSummary(error))
          countReply({ failure: true })
          return corsJson(UNAVAILABLE_BODY, 503, cors)
        }
        console.error('Widget RAG query error:', error)
        // Continue with generic response if RAG fails
      }
    } else {
      console.log('Widget Chat API - No documents found in knowledge base')
    }

    // Pass retrieved passages to the chat model only when some were found
    const context = ragResult && isEnhanced ? ragResult.context : undefined
    
    // Generate the answer with the widget's own prompts
    const systemPrompt = widgetSystemPrompt(widget.system_prompt)
    
    if (sharedClaim) {
      const refused = refuseAtCap(await sharedClaim)
      if (refused) return refused
    }

    // An owner model answers alone: a failure is an error, never a Groq answer (D8)
    const provider = model ? ownerProvider(model) : demoProvider()
    let response
    try {
      response = await generateResponse({
        query: message,
        context,
        sessionId: sessionId || 'widget-session',
        isEnhanced,
        systemPrompt,
        roleContext: widget.role_context,
        // Talking to a visitor: no "upload a document", no "the documents provided".
        audience: 'visitor',
      }, provider)
    } catch (error) {
      if (!isModelError(error)) throw error
      console.error(`Widget chat model error code=${error.code}`)
      countReply({ failure: true })
      return corsJson(UNAVAILABLE_BODY, 503, cors)
    }
    
    // The conversation log: only for a database-backed widget, only when the
    // owner turned it on (recordTurn checks), and only when the widget says it
    // showed the visitor the notice. Written after the reply is sent.
    if (ctx.database && logNotice === true && typeof message === 'string') {
      const { connection, workspaceId } = ctx.database
      const turn = { chatId, question: message, answer: response.message, matched: isEnhanced, matchScore: confidence, sources: ragResult?.sources || [] }
      later(() => recordTurn(connection, workspaceId, turn))
    }
    countReply({ failure: false, matched: isEnhanced, score: confidence, answer: response.message })

    const responseData: any = {
      message: response.message,
      confidence,
      sources: ragResult?.sources || [],
      isEnhanced,
      sessionId: sessionId || 'widget-session',
      widgetKey
    }

    return corsJson(responseData, 200, cors)
      
  } catch (error) {
    countReply({ failure: true })
    // Raw errors on the provider path can carry hostnames or provider text: log the code only
    console.error(`Widget chat error code=${chatErrorCode(error)} type=${error instanceof Error ? error.name : typeof error}`)
    return new NextResponse(JSON.stringify({ 
      message: 'Sorry, I encountered an error. Please try again.',
      isEnhanced: false,
      sessionId: 'error-session'
    }), {
      status: 500,
      headers: cors,
    })
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