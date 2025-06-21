import OpenAI from 'openai'

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export interface ChatResponse {
  message: string
  confidence: number
  sources?: string[]
}

export interface GenerateResponseOptions {
  query: string
  context?: string
  sessionId?: string
  isEnhanced?: boolean
  systemPrompt?: string
  roleContext?: string
}

// Generate chat response using OpenAI
export async function generateResponse(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  context?: string,
  systemPrompt?: string
): Promise<string> {
  try {
    let systemPrompt = ''
    let userPrompt = messages[messages.length - 1].content

    // Use custom system prompt if provided, otherwise use default logic
    if (systemPrompt) {
      systemPrompt = systemPrompt
      
      if (context) {
        // Enhance the custom prompt with context instructions
        systemPrompt += `\n\nYou have access to specific documents that are relevant to the user's questions. Use the provided context to give detailed, accurate answers. Always cite your sources when possible.`
        userPrompt = `${context}\n\nUser Question: ${userPrompt}`
      } else {
        // Use role-based prompt without context
        systemPrompt += `\n\nYou should provide helpful information based on your role, but acknowledge when you don't have access to specific details. Suggest that the user might benefit from uploading relevant documents for more detailed answers.`
      }
    } else {
      // Default system prompts (fallback)
      if (context) {
        systemPrompt = `You are a helpful AI assistant with access to specific documents. 
        Provide detailed, accurate answers based on the provided context. 
        Always cite your sources when possible.
        If the context doesn't fully answer the question, be honest about limitations.`
        
        userPrompt = `${context}\n\nUser Question: ${userPrompt}`
      } else {
        systemPrompt = `You are a helpful AI assistant. 
        You should provide general information but acknowledge when you don't have access to specific details.
        Be honest about your limitations and suggest that the user might need to provide more specific information or documentation for detailed answers.
        Keep responses concise and helpful.`
      }
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      max_tokens: context ? 500 : 300, // More tokens for enhanced responses
      temperature: 0.7,
    })

    const message = response.choices[0]?.message?.content || 'I apologize, but I was unable to generate a response.'
    
    // Calculate confidence based on response type and content quality
    let confidence = 30 // Default low confidence
    
    if (context) {
      // Enhanced responses get higher confidence
      confidence = 85
      
      // Boost confidence if response seems comprehensive
      if (message.length > 200) {
        confidence = Math.min(95, confidence + 10)
      }
    } else {
      // Generic responses get lower confidence
      confidence = 30
      
      // Slightly boost if response acknowledges limitations appropriately
      if (message.toLowerCase().includes('specific') || 
          message.toLowerCase().includes('more information') ||
          message.toLowerCase().includes('documentation')) {
        confidence = 35
      }
    }

    return message
  } catch (error) {
    console.error('OpenAI API error:', error)
    
    // Return fallback response
         return context 
       ? "I'm having trouble accessing your uploaded knowledge right now. Please try again."
       : "I don't have access to your specific information. Could you provide more details or upload relevant documents for a more accurate answer?"
  }
}

// Generate embeddings for document chunks
export async function generateEmbeddings(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.trim(),
    })

    return response.data[0]?.embedding || []
  } catch (error) {
    console.error('Embedding generation error:', error)
    
    // Return a zero vector as fallback
    return new Array(1536).fill(0)
  }
}

// Batch generate embeddings for better performance
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts.map(text => text.trim()),
    })

    return response.data.map(item => item.embedding)
  } catch (error) {
    console.error('Batch embedding generation error:', error)
    
    // Return zero vectors as fallback
    return texts.map(() => new Array(1536).fill(0))
  }
}

// Test OpenAI connection
export async function testOpenAIConnection(): Promise<boolean> {
  try {
    await openai.models.list()
    return true
  } catch (error) {
    console.error('OpenAI connection test failed:', error)
    return false
  }
}

export default openai 