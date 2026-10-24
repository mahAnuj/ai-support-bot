import { NextRequest, NextResponse } from 'next/server'
import { generateResponse } from '../../../../lib/llm'
import { getWidgetByKey, findRelevantChunksForKnowledgeBase, knowledgeBaseHasDocuments, getInMemoryDatabase } from '../../../../lib/database'
import { getCachedEmbedding } from '../../../../lib/rag'
import { matchScore, MIN_SIMILARITY } from '../../../../lib/embeddings'
import { clientIp, isRateLimited, LIMITS, originAllowed } from '../../../../lib/guard'

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function corsJson(body: unknown, status: number) {
  return new NextResponse(JSON.stringify(body), { status, headers: CORS_HEADERS })
}

export async function POST(request: NextRequest) {
  try {
    console.log('🔥 WIDGET CHAT API CALLED')
    if (isRateLimited(`widget:${clientIp(request)}`, 20)) {
      return corsJson({ error: 'Too many requests' }, 429)
    }

    const { message, widgetKey, sessionId } = await request.json()

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

    // Look up widget
    const widget = await getWidgetByKey(widgetKey)
    if (!widget) {
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

    if (!originAllowed(request.headers.get('origin'), widget.allowed_domains)) {
      return corsJson({ error: 'This widget is not enabled for this site' }, 403)
    }

    console.log('Widget Chat API - Widget found:', widget.widget_key)
    
    let ragResult = null
    let isEnhanced = false
    let confidence = 0 // Match score; stays 0 when no passage is used
    
    // Check if widget's knowledge base has documents for RAG
    console.log('Widget Chat API - Knowledge Base ID:', widget.knowledge_base_id)
    
    if (await knowledgeBaseHasDocuments(widget.knowledge_base_id)) {
      try {
        // Generate embedding for the query
        const queryEmbedding = await getCachedEmbedding(message)
        
        // Query the RAG system for relevant context
        const relevantChunks = await findRelevantChunksForKnowledgeBase({
          knowledge_base_id: widget.knowledge_base_id,
          query_embedding: queryEmbedding,
          similarity_threshold: MIN_SIMILARITY,
          max_results: 5
        })
        
        console.log('Widget Chat API - RAG result:', {
          relevantChunks: relevantChunks.length,
          widgetKey
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
        console.error('Widget RAG query error:', error)
        // Continue with generic response if RAG fails
      }
    } else {
      console.log('Widget Chat API - No documents found in knowledge base')
    }

    // Pass retrieved passages to the chat model only when some were found
    const context = ragResult && isEnhanced ? ragResult.context : undefined
    
    // Get knowledge base for system prompt and role context
    const db = getInMemoryDatabase()
    const knowledgeBase = db.knowledgeBases.get(widget.knowledge_base_id)
    
    // Generate the answer with the widget's own prompts
    const systemPrompt = knowledgeBase?.system_prompt || 
      'You are a helpful AI assistant embedded in a website widget. Provide helpful and accurate information formatted with proper markdown for easy reading.'
    
    const response = await generateResponse({
      query: message,
      context,
      sessionId: sessionId || 'widget-session',
      isEnhanced,
      systemPrompt,
      roleContext: knowledgeBase?.role_context
    })
    
    const responseData: any = {
      message: response.message,
      confidence,
      sources: ragResult?.sources || [],
      isEnhanced,
      sessionId: sessionId || 'widget-session',
      widgetKey
    }

    return new NextResponse(JSON.stringify(responseData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
      
  } catch (error) {
    console.error('Widget chat error:', error)
    return new NextResponse(JSON.stringify({ 
      message: 'Sorry, I encountered an error. Please try again.',
      confidence: 0,
      sources: [],
      isEnhanced: false,
      sessionId: 'error-session'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
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