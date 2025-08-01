import { NextRequest, NextResponse } from 'next/server'
import { generateResponse } from '../../../../lib/openai'
import { getWidgetByKey, findRelevantChunksForKnowledgeBase, knowledgeBaseHasDocuments, getInMemoryDatabase } from '../../../../lib/database'
import { getCachedEmbedding } from '../../../../lib/rag'

export async function POST(request: NextRequest) {
  try {
    console.log('🔥 WIDGET CHAT API CALLED')
    const { message, widgetKey, sessionId } = await request.json()
    
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

    console.log('Widget Chat API - Widget found:', widget.widget_key)
    
    let ragResult = null
    let isEnhanced = false
    let confidence = 30 // Default low confidence for generic responses
    
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
          similarity_threshold: 0.5,
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
        
        // Calculate confidence based on similarity scores
        const avgSimilarity = relevantChunks.length > 0 
          ? relevantChunks.reduce((sum, chunk) => sum + chunk.similarity, 0) / relevantChunks.length
          : 0
        
        let calculatedConfidence = Math.round(avgSimilarity * 100)
        
        // Boost confidence if we have multiple relevant chunks
        if (relevantChunks.length >= 3) {
          calculatedConfidence = Math.min(95, calculatedConfidence + 10)
        } else if (relevantChunks.length >= 2) {
          calculatedConfidence = Math.min(90, calculatedConfidence + 5)
        }
        
        // Ensure minimum confidence for any results
        if (relevantChunks.length > 0) {
          calculatedConfidence = Math.max(calculatedConfidence, 40)
        }
        
        ragResult = {
          context: context.trim(),
          sources: Array.from(usedSources),
          relevantChunks,
          confidence: calculatedConfidence
        }
        
        isEnhanced = context.length > 0 && calculatedConfidence > 50
        
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

    // Create context for OpenAI if we have RAG results
    const context = ragResult && isEnhanced ? ragResult.context : undefined
    
    // Get knowledge base for system prompt and role context
    const db = getInMemoryDatabase()
    const knowledgeBase = db.knowledgeBases.get(widget.knowledge_base_id)
    
    // Generate response using OpenAI with widget-specific prompts
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
      confidence: response.confidence || confidence,
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