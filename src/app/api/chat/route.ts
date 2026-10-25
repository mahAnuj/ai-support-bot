import { NextRequest, NextResponse } from 'next/server'
import { chatErrorCode, generateResponse } from '../../../lib/llm'
import { demoProvider, ownerProvider } from '../../../lib/model/provider'
import { modelErrorResponse, resolveBuilderModel } from '../../../lib/model/resolve'
import { isModelError, modelErrorMessage } from '../../../lib/model/shared'
import { queryRAG, createRAGContext, sessionHasDocuments } from '../../../lib/rag'
import { clientIp, isRateLimited, isWithinLimit, LIMITS } from '../../../lib/guard'
import { resolveBuilderStore, storageErrorResponse } from '../../../lib/storage/resolve'
import { StorageError, isStorageError, safeErrorSummary } from '../../../lib/storage/errors'

export async function POST(request: NextRequest) {
  try {
    if (isRateLimited(`chat:${clientIp(request)}`, 20)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    // Resolved before the body is read, so a bad or wrong-purpose token reads and writes nothing
    const resolved = resolveBuilderStore(request)
    if (!resolved.ok) return storageErrorResponse(resolved.error)
    const ctx = resolved.ctx
    const store = ctx.store
    const resolvedModel = resolveBuilderModel(request)
    if (!resolvedModel.ok) return modelErrorResponse(resolvedModel.error)
    // No owner model means the demo model; with one, every call goes to it and nothing falls back (D8, D9)
    const provider = resolvedModel.model ? ownerProvider(resolvedModel.model) : demoProvider()

    const { message, sessionId, systemPrompt, roleContext } = await request.json()
    
    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      )
    }

    if (
      message.length > LIMITS.message ||
      !isWithinLimit(systemPrompt, LIMITS.systemPrompt) ||
      !isWithinLimit(roleContext, LIMITS.roleContext)
    ) {
      return NextResponse.json({ error: 'Input too long' }, { status: 400 })
    }

    // Ensure we have a valid database session
    let currentSessionId = sessionId
    let dbSession = null
    
    if (ctx.kind === 'postgres') {
      // The token decides the workspace; a sessionId in the body is ignored
      currentSessionId = ctx.workspaceId
      dbSession = await store.getWorkspace(currentSessionId)
      if (!dbSession) throw new StorageError('workspace_not_found')
    } else if (sessionId) {
      // Check if provided session exists
      dbSession = await store.getWorkspace(sessionId)
      if (!dbSession) {
        console.log(`Chat API - Session ${sessionId} not found, creating new one`)
        dbSession = await store.createWorkspace()
        currentSessionId = dbSession.id
      } else {
        console.log(`Chat API - Using existing session: ${sessionId}`)
      }
    } else {
      // Create new session
      console.log('Chat API - No sessionId provided, creating new session')
      dbSession = await store.createWorkspace()
      currentSessionId = dbSession.id
    }

    let ragResult = null
    let isEnhanced = false
    let confidence = 0 // Match score; stays 0 when no passage is used
    
    // Check if we have a session with documents for RAG
    console.log('Chat API - SessionId:', currentSessionId)
    console.log('Chat API - Has documents:', await sessionHasDocuments(store, currentSessionId))
    
    if (await sessionHasDocuments(store, currentSessionId)) {
      try {
        // Query the RAG system for relevant context
        ragResult = await queryRAG(store, currentSessionId, message, 5, provider)
        console.log('Chat API - RAG result:', {
          contextLength: ragResult.context.length,
          confidence: ragResult.confidence,
          sources: ragResult.sources,
          relevantChunks: ragResult.relevantChunks.length
        })
        
        isEnhanced = ragResult.context.length > 0
        
        if (isEnhanced) {
          confidence = ragResult.confidence
        }
      } catch (error) {
        if (isStorageError(error)) throw error
        console.error('RAG query error:', error)
        // Continue with generic response if RAG fails
      }
    } else {
      console.log('Chat API - No session or no documents found')
    }

    // Pass retrieved passages to the chat model only when some were found
    const context = ragResult && isEnhanced ? createRAGContext(ragResult) : undefined
    console.log('Chat API - isEnhanced:', isEnhanced, 'context length:', context?.length || 0)
    
    // Generate the answer
    const response = await generateResponse({
      query: message,
      context,
      sessionId: currentSessionId,
      isEnhanced,
      systemPrompt,
      roleContext
    }, provider)

    const responseData: any = {
      message: response.message,
      confidence,
      sources: ragResult && isEnhanced ? ragResult.sources : undefined,
      isEnhanced,
      sessionId: currentSessionId
    }
    
    return NextResponse.json(responseData)
    
  } catch (error) {
    if (isStorageError(error)) {
      console.error(`Chat API storage error ${safeErrorSummary(error)}`)
      return storageErrorResponse(error)
    }
    // Raw errors on the provider path can carry hostnames or provider text: log the code only
    console.error(`Chat API error code=${chatErrorCode(error)} type=${error instanceof Error ? error.name : typeof error}`)
    if (isModelError(error)) {
      return NextResponse.json(
        {
          error: 'Failed to generate response',
          code: error.code,
          details: modelErrorMessage(error.code, error.httpStatus),
        },
        { status: 502 }
      )
    }

    return NextResponse.json(
      { 
        error: 'Failed to generate response',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

// Handle OPTIONS for CORS
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