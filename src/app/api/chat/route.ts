import { NextRequest, NextResponse } from 'next/server'
import { generateResponse } from '../../../lib/openai'
import { queryRAG, createRAGContext, sessionHasDocuments } from '../../../lib/rag'
import { createSession, getSession } from '../../../lib/database'

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId, systemPrompt, roleContext } = await request.json()
    
    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      )
    }

    // Ensure we have a valid database session
    let currentSessionId = sessionId
    let dbSession = null
    
    if (sessionId) {
      // Check if provided session exists
      dbSession = await getSession(sessionId)
      if (!dbSession) {
        console.log(`Chat API - Session ${sessionId} not found, creating new one`)
        dbSession = await createSession()
        currentSessionId = dbSession.id
      } else {
        console.log(`Chat API - Using existing session: ${sessionId}`)
      }
    } else {
      // Create new session
      console.log('Chat API - No sessionId provided, creating new session')
      dbSession = await createSession()
      currentSessionId = dbSession.id
    }

    let ragResult = null
    let isEnhanced = false
    let confidence = 30 // Default low confidence for generic responses
    
    // Check if we have a session with documents for RAG
    console.log('Chat API - SessionId:', currentSessionId)
    console.log('Chat API - Has documents:', await sessionHasDocuments(currentSessionId))
    
    if (await sessionHasDocuments(currentSessionId)) {
      try {
        // Query the RAG system for relevant context
        ragResult = await queryRAG(currentSessionId, message)
        console.log('Chat API - RAG result:', {
          contextLength: ragResult.context.length,
          confidence: ragResult.confidence,
          sources: ragResult.sources,
          relevantChunks: ragResult.relevantChunks.length
        })
        
        isEnhanced = ragResult.context.length > 0 && ragResult.confidence > 30
        
        if (isEnhanced) {
          confidence = ragResult.confidence
        }
      } catch (error) {
        console.error('RAG query error:', error)
        // Continue with generic response if RAG fails
      }
    } else {
      console.log('Chat API - No session or no documents found')
    }

    // Create context for OpenAI if we have RAG results
    const context = ragResult && isEnhanced ? createRAGContext(ragResult) : undefined
    console.log('Chat API - isEnhanced:', isEnhanced, 'context length:', context?.length || 0)
    
    // Generate response using OpenAI
    const response = await generateResponse({
      query: message,
      context,
      sessionId: currentSessionId,
      isEnhanced,
      systemPrompt,
      roleContext
    })

    // Use RAG confidence if available and enhanced
    if (ragResult && isEnhanced) {
      response.confidence = confidence
      response.sources = ragResult.sources
    } else {
      // Ensure generic responses have appropriately low confidence
      response.confidence = Math.min(response.confidence || 30, 40)
    }

    const responseData: any = {
      message: response.message,
      confidence: response.confidence,
      sources: response.sources,
      isEnhanced,
      sessionId: currentSessionId
    }
    
    return NextResponse.json(responseData)
    
  } catch (error) {
    console.error('Chat API error:', error)
    
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