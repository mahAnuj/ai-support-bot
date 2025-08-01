import OpenAI from 'openai'

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export interface ChatResponse {
  message: string
  confidence: number
  sources?: string[]
  reasoning?: string
  action_items?: string[]
}

export interface StructuredResponse {
  answer: string
  reasoning?: string
  action_items?: string[]
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
  structured?: boolean // New option for structured responses
}

// Generate chat response using OpenAI
export async function generateResponse({
  query,
  context,
  isEnhanced = false,
  systemPrompt: customSystemPrompt,
  roleContext,
  structured = false
}: GenerateResponseOptions): Promise<ChatResponse> {
  try {
    let systemPrompt = ''
    let userPrompt = query

    // Use custom system prompt if provided, otherwise use default logic
    if (customSystemPrompt) {
      systemPrompt = customSystemPrompt
      
      if (isEnhanced && context) {
        // Enhance the custom prompt with context instructions
        systemPrompt += `\n\nYou have access to specific documents that are relevant to the user's questions. Use the provided context to give detailed, accurate answers. Always cite your sources when possible.`
        userPrompt = `${context}\n\nUser Question: ${query}`
      } else {
        // Use role-based prompt without context
        systemPrompt += `\n\nYou should provide helpful information based on your role, but acknowledge when you don't have access to specific details. Suggest that the user might benefit from uploading relevant documents for more detailed answers.`
      }
    } else {
      // Default system prompts (fallback)
      if (isEnhanced && context) {
        systemPrompt = `You are a helpful AI business assistant with access to specific company documents.

FORMATTING RULES:
- Use **bold text** for emphasis and important points
- Use numbered lists for step-by-step instructions: "1. First step\n\n2. Second step"
- Use bullet points for features or lists: "• Feature one\n• Feature two"
- Use proper line breaks between paragraphs for readability
- Use backticks for technical terms and code
- Format responses to be clear and easy to scan

RESPONSE RULES:
- Start with the direct answer, then provide supporting details
- Be comprehensive but organized with good formatting
- Cite sources when relevant
- If context is incomplete, say "Based on available documents..." and be specific about limitations

Always format your response with proper markdown for easy reading.`
        
        userPrompt = `${context}\n\nUser Question: ${query}`
      } else {
        systemPrompt = `You are a helpful AI assistant providing general guidance.

FORMATTING RULES:
- Use **bold text** for emphasis and important points
- Use numbered lists for step-by-step instructions: "1. First step\n\n2. Second step"
- Use bullet points for features or lists: "• Feature one\n• Feature two"
- Use proper line breaks between paragraphs for readability
- Use backticks for technical terms and code
- Format responses to be clear and easy to scan

RESPONSE RULES:
- Be direct and actionable
- Acknowledge limitations clearly
- Suggest uploading relevant documents for specific details
- Use simple, clear language

FORMAT: Direct answer first, then brief suggestion if applicable.`
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
      max_tokens: isEnhanced ? 250 : 150, // Reduced for conciseness
      temperature: 0.3, // Lower temperature for more focused responses
      presence_penalty: 0.1, // Slight penalty to avoid repetition
      frequency_penalty: 0.1, // Encourage conciseness
    })

    let message = response.choices[0]?.message?.content || 'I apologize, but I was unable to generate a response.'
    
    // Post-process for conciseness
    const maxWords = isEnhanced ? 100 : 80
    message = ensureConciseResponse(message, maxWords)
    
    // Calculate confidence based on response type and content quality
    let confidence = 30 // Default low confidence
    
    if (isEnhanced && context) {
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

    return {
      message,
      confidence
    }
  } catch (error) {
    console.error('OpenAI API error:', error)
    
    // Return fallback response
    return {
      message: isEnhanced 
        ? "I'm having trouble accessing your uploaded knowledge right now. Please try again."
        : "I don't have access to your specific information. Could you provide more details or upload relevant documents for a more accurate answer?",
      confidence: 10
    }
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

// Generate structured response with specific format
export async function generateStructuredResponse({
  query,
  context,
  isEnhanced = false,
  systemPrompt: customSystemPrompt,
  roleContext
}: Omit<GenerateResponseOptions, 'structured'>): Promise<StructuredResponse> {
  try {
        let systemPrompt = customSystemPrompt || `You are a helpful AI assistant. You must respond with valid JSON only.

Response JSON STRUCTURE:
{
  "answer": "your helpful response here formatted in proper markdown",
  "confidence": 85,
  "sources": ["source1", "source2"]
}

No of fields in JSON response are 3: answer, confidence, sources

Type of fields in JSON response:
- "answer" field is a string, formatted in markdown format
- "confidence" field is a number between 0 and 100
- "sources" field is an array of strings

MARKDOWN FORMATTING RULES for the "answer" field:
1. Use **bold text** for emphasis
2. Use numbered lists for steps: "1. First step\n2. Second step\n3. Third step"
3. Use bullet points for features: "• Feature one\n• Feature two"
4. Use proper line breaks between paragraphs
5. Use backtick code formatting for technical terms
6. Format the response to be clear and readable

CORRECT Examples:
{"answer": "Our business hours are **9 AM to 5 PM** Monday through Friday.", "confidence": 90, "sources": ["general_knowledge"]}
{"answer": "To reset your password, follow these steps:\n\n1. Go to the login page\n2. Click **Forgot Password**\n3. Enter your email address\n4. Check your email for the reset link\n\nThe process is secure and you'll receive a confirmation email.", "confidence": 85, "sources": ["general_knowledge"]}
`

    if (isEnhanced && context) {
      systemPrompt += `\n\nYou have access to specific documents. Use them to provide accurate, cited information in JSON format. In the "sources" field, reference the specific document sections you used. Format your answer with proper markdown including numbered steps where appropriate.`
      query = `${context}\n\nUser Question: ${query}\n\nPlease respond in JSON format as specified.`
    } else {
      query = `${query}\n\nPlease respond in JSON format as specified.`
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
          content: query
        }
      ],
      max_tokens: 500, // Increased for JSON responses
      temperature: 0.1, // Very low for consistent JSON structure
    })

    const rawResponse = response.choices[0]?.message?.content || '{}'
    
    console.log('🔍 Raw OpenAI response:', rawResponse)
    
    try {
      const parsed = JSON.parse(rawResponse)
      console.log('✅ Parsed JSON successfully:', parsed)
      console.log('🔍 Available fields:', Object.keys(parsed))
      console.log('📝 Answer field value:', parsed.answer)
      console.log('📝 Action items field value:', parsed.action_items)
      console.log('📝 Reasoning field value:', parsed.reasoning)
      console.log('📝 Sources field value:', parsed.sources)
      console.log('📝 All field values:', JSON.stringify(parsed, null, 2))
      
      // Handle the new simplified JSON response format
      let answerText = ''
      
      if (parsed.answer) {
        // New format: {"answer": "markdown formatted text", "sources": [...]}
        answerText = parsed.answer
      } else {
        // Fallback to any text field
        answerText = parsed.message || 
                    parsed.response || 
                    parsed.content || 
                    parsed.text ||
                    JSON.stringify(parsed) // Show the JSON if we can't find the answer field
      }
      
      console.log('🎯 Final answer text:', answerText)
      
      return {
        answer: answerText,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 30,
        sources: parsed.sources || (isEnhanced && context ? ['uploaded_documents'] : ['general_knowledge'])
      }
    } catch (parseError) {
      console.error('Failed to parse structured response:', parseError)
      console.error('Raw response was:', rawResponse)
      
      return {
        answer: 'I encountered an error generating a structured response.',
        confidence: 10,
        sources: ['general_knowledge']
      }
    }
    
  } catch (error) {
    console.error('Structured response error:', error)
    return {
      answer: 'Unable to generate response at this time.',
      confidence: 0,
      sources: ['general_knowledge']
    }
  }
}

// Post-process response to ensure conciseness
export function ensureConciseResponse(message: string, maxWords: number = 100): string {
  const words = message.trim().split(/\s+/)
  
  if (words.length <= maxWords) {
    return message
  }
  
  // Try to find a good breaking point (sentence end)
  const sentences = message.split(/[.!?]+/)
  let result = ''
  let wordCount = 0
  
  for (const sentence of sentences) {
    const sentenceWords = sentence.trim().split(/\s+/).length
    if (wordCount + sentenceWords <= maxWords) {
      result += sentence.trim() + '. '
      wordCount += sentenceWords
    } else {
      break
    }
  }
  
  // If no complete sentences fit, truncate at word boundary
  if (!result.trim()) {
    result = words.slice(0, maxWords).join(' ') + '...'
  }
  
  return result.trim()
}

export default openai 