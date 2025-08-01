import { generateEmbeddings } from './openai'
import { chunkText, extractTextFromFile } from './documents'
import { 
  createSession, 
  storeDocument, 
  findRelevantChunks, 
  getSession,
  updateSessionAccess 
} from './database'
import type { VectorSearchResult } from '../types/database'

export interface RAGProcessResult {
  sessionId: string
  documentsProcessed: number
  totalChunks: number
  totalWords: number
}

export interface RAGQueryResult {
  context: string
  sources: string[]
  relevantChunks: VectorSearchResult[]
  confidence: number
}

// Cache for embeddings to avoid regenerating for same content
const embeddingCache = new Map<string, number[]>()

// Cache for query variations to avoid duplicate OpenAI calls
const variationCache = new Map<string, string[]>()

// Preprocess queries to improve semantic matching
function preprocessQuery(query: string): string {
  // Simple preprocessing - just clean up the query
  return query.trim()
}

// Generate multiple query variations using OpenAI for better semantic matching
async function generateQueryVariations(query: string): Promise<string[]> {
  const cacheKey = query.trim().toLowerCase()
  
  // Check cache first
  if (variationCache.has(cacheKey)) {
    console.log(`🤖 Using cached variations for: "${query}"`)
    return variationCache.get(cacheKey)!
  }
  
  const variations = [query] // Always include the original
  
  try {
    console.log(`🤖 Generating query variations for: "${query}"`)
    
    // Use OpenAI directly with structured JSON response for reliability
    const openai = (await import('openai')).default
    const client = new openai({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that generates alternative phrasings for user questions to improve semantic search results.'
        },
        {
          role: 'user',
          content: `Generate 3 alternative ways to ask this question: "${query}"

Focus on:
- Different phrasings and word choices
- More specific or more general versions  
- Common ways users might express the same need
- Synonyms and related terms

Examples:
- "What file formats are supported?" → "What types of files can I upload?", "Which document formats are accepted?", "What file extensions are allowed?"
- "How do I get started?" → "What should I do first?", "How do I begin using this?", "Where do I start?"

Return ONLY the 3 alternative questions in valid JSON format.`
        }
      ],
      response_format: { 
        type: "json_schema",
        json_schema: {
          name: "query_variations",
          schema: {
            type: "object",
            properties: {
              variations: {
                type: "array",
                items: { type: "string" },
                minItems: 3,
                maxItems: 3,
                description: "Three alternative ways to ask the same question"
              }
            },
            required: ["variations"],
            additionalProperties: false
          }
        }
      },
      max_tokens: 150,
      temperature: 0.7
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      throw new Error('No response from OpenAI')
    }

    // Parse the structured JSON response
    const parsed = JSON.parse(content)
    const aiVariations = parsed.variations || []

    if (aiVariations.length > 0) {
      variations.push(...aiVariations)
      console.log(`🤖 Generated ${aiVariations.length} AI variations:`, aiVariations)
    } else {
      throw new Error('No valid variations generated')
    }
  } catch (error) {
    console.warn('🤖 AI variation generation error, using fallback:', error)
    // Fallback for any errors - simple variations
    const lowerQuery = query.toLowerCase()
    if (!lowerQuery.includes('what') && !lowerQuery.includes('how')) {
      variations.push(`what ${query}`)
      variations.push(`how ${query}`)
    }
  }
  
  const result = [...new Set(variations.slice(0, 5))] // Limit to 5 total, remove duplicates
  
  // Cache the result
  variationCache.set(cacheKey, result)
  
  // Limit cache size to prevent memory issues
  if (variationCache.size > 100) {
    const firstKey = variationCache.keys().next().value
    if (firstKey) {
      variationCache.delete(firstKey)
    }
  }
  
  return result
}

// Get cached embedding or generate new one
export async function getCachedEmbedding(text: string): Promise<number[]> {
  const cacheKey = text.trim().toLowerCase()
  
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey)!
  }
  
  const embedding = await generateEmbeddings(text)
  embeddingCache.set(cacheKey, embedding)
  
  // Limit cache size to prevent memory issues
  if (embeddingCache.size > 1000) {
    const firstKey = embeddingCache.keys().next().value
    if (firstKey) {
      embeddingCache.delete(firstKey)
    }
  }
  
  return embedding
}

// Process and store documents in vector database
export async function processDocumentsForRAG(files: File[]): Promise<RAGProcessResult> {
  // Create new session
  const session = await createSession()
  
  let totalChunks = 0
  let totalWords = 0
  
  // Process files in parallel for better performance
  const fileProcessingPromises = files.map(async (file) => {
    try {
      // Extract text from file (now handles PDF, DOCX, TXT)
      const extractedText = await extractTextFromFile(file)
      
      if (!extractedText.trim()) {
        console.warn(`No text content found in file: ${file.name}`)
        return { chunks: 0, words: 0 }
      }
      
      // Chunk the text with FAQ-optimized parameters
      const chunks = chunkText(extractedText, 400, 50) // Smaller chunks for FAQ-style content
      
      // Generate embeddings in batches to avoid rate limits
      const batchSize = 5
      const chunksWithEmbeddings = []
      
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize)
        const batchPromises = batch.map(async (chunk, index) => ({
          content: chunk.content,
          embedding: await getCachedEmbedding(chunk.content),
          index: i + index
        }))
        
        const batchResults = await Promise.all(batchPromises)
        chunksWithEmbeddings.push(...batchResults)
        
        // Small delay between batches to respect rate limits
        if (i + batchSize < chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
      
      // Store in database
      console.log(`RAG - Storing document: ${file.name} with ${chunksWithEmbeddings.length} chunks`)
      await storeDocument(session.id, file.name, chunksWithEmbeddings)
      
      const wordCount = extractedText.split(/\s+/).length
      console.log(`RAG - Processed ${file.name}: ${chunks.length} chunks, ${wordCount} words`)
      return { chunks: chunks.length, words: wordCount }
      
    } catch (error) {
      console.error(`Error processing file ${file.name}:`, error)
      throw new Error(`Failed to process file ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  })
  
  // Wait for all files to be processed
  const results = await Promise.all(fileProcessingPromises)
  
  // Aggregate results
  for (const result of results) {
    totalChunks += result.chunks
    totalWords += result.words
  }
  
  return {
    sessionId: session.id,
    documentsProcessed: files.length,
    totalChunks,
    totalWords
  }
}

// Query the RAG system for relevant context
export async function queryRAG(
  sessionId: string, 
  query: string,
  maxResults: number = 5,
  similarityThreshold: number = 0.4 // Balanced threshold - will be adjusted dynamically
): Promise<RAGQueryResult> {
  // Check if session exists and update access time
  const session = await getSession(sessionId)
  if (!session) {
    throw new Error('Session not found')
  }
  
  await updateSessionAccess(sessionId)
  
  // Preprocess query to improve semantic matching
  const preprocessedQuery = preprocessQuery(query)
  console.log(`RAG Query - Original: "${query}"`)
  console.log(`RAG Query - Preprocessed: "${preprocessedQuery}"`)
  
  // Generate query variations for better semantic matching
  const queryVariations = await generateQueryVariations(preprocessedQuery)
  console.log(`RAG Query - Variations: ${JSON.stringify(queryVariations)}`)
  
  // Smart multi-threshold search with quality filtering
  let bestResults: VectorSearchResult[] = []
  let bestVariation = queryVariations[0]
  
  for (const variation of queryVariations) {
    const queryEmbedding = await getCachedEmbedding(variation)
    
    // Try multiple thresholds: start high, go lower if needed
    const thresholds = [0.5, 0.4, 0.3, 0.25]
    let variationResults: VectorSearchResult[] = []
    
    for (const threshold of thresholds) {
      const results = await findRelevantChunks({
        session_id: sessionId,
        query_embedding: queryEmbedding,
        similarity_threshold: threshold,
        max_results: maxResults
      })
      
      // Use this threshold if we get good results or if it's our last attempt
      if (results.length >= 2 || threshold === thresholds[thresholds.length - 1]) {
        variationResults = results
        console.log(`RAG Query - Using threshold ${threshold} for "${variation}" (found ${results.length} chunks)`)
        break
      }
    }
    
    // Apply quality filtering: remove chunks that are much worse than the best
    if (variationResults.length > 0) {
      const topSimilarity = variationResults[0].similarity
      const qualityThreshold = Math.max(0.25, topSimilarity - 0.15) // Max 15% gap from best
      
      const filteredResults = variationResults.filter(chunk => 
        chunk.similarity >= qualityThreshold
      )
      
      console.log(`RAG Query - Quality filter: ${variationResults.length} → ${filteredResults.length} chunks (gap threshold: ${qualityThreshold.toFixed(3)})`)
      
      // Keep the best variation (highest average similarity)
      if (filteredResults.length > 0) {
        const avgSimilarity = filteredResults.reduce((sum, chunk) => sum + chunk.similarity, 0) / filteredResults.length
        const currentBestAvg = bestResults.length > 0 
          ? bestResults.reduce((sum, chunk) => sum + chunk.similarity, 0) / bestResults.length 
          : 0
          
        if (avgSimilarity > currentBestAvg) {
          bestResults = filteredResults
          bestVariation = variation
          console.log(`RAG Query - New best variation: "${variation}" (avg similarity: ${avgSimilarity.toFixed(3)})`)
        }
      }
    }
  }
  
  const relevantChunks = bestResults
  console.log(`RAG Query - Final results: ${relevantChunks.length} chunks from "${bestVariation}"`)
  
  // Create context from relevant chunks with smart truncation
  const maxContextLength = 2000 // Optimize for token limits
  let context = ''
  const usedSources = new Set<string>()
  
  for (const chunk of relevantChunks) {
    const addition = `${chunk.content}\n\n`
    
    if (context.length + addition.length > maxContextLength) {
      // Try to fit partial content if there's space
      const remainingSpace = maxContextLength - context.length
      if (remainingSpace > 100) {
        context += chunk.content.substring(0, remainingSpace - 10) + '...\n\n'
      }
      break
    }
    
    context += addition
    usedSources.add(chunk.filename)
  }
  
  // Extract unique source filenames
  const sources = Array.from(usedSources)
  
  // Smart confidence calculation based on quality and consistency
  let confidence = 30 // Default for no results
  
  if (relevantChunks.length > 0) {
    const avgSimilarity = relevantChunks.reduce((sum, chunk) => sum + chunk.similarity, 0) / relevantChunks.length
    const topSimilarity = relevantChunks[0].similarity
    const minSimilarity = relevantChunks[relevantChunks.length - 1].similarity
    
    // Base confidence from average similarity
    confidence = Math.round(avgSimilarity * 100)
    
    // Boost for high-quality top result
    if (topSimilarity >= 0.6) {
      confidence += 15
    } else if (topSimilarity >= 0.5) {
      confidence += 10
    } else if (topSimilarity >= 0.4) {
      confidence += 5
    }
    
    // Boost for multiple consistent results (low variance)
    if (relevantChunks.length >= 2) {
      const variance = topSimilarity - minSimilarity
      if (variance <= 0.1) { // Very consistent results
        confidence += 10
      } else if (variance <= 0.15) { // Moderately consistent
        confidence += 5
      }
    }
    
    // Boost for multiple sources
    if (relevantChunks.length >= 3) {
      confidence += 5
    }
    
    // Cap at reasonable limits
    confidence = Math.min(95, Math.max(40, confidence))
    
    console.log(`RAG Query - Confidence calculation: avg=${avgSimilarity.toFixed(3)}, top=${topSimilarity.toFixed(3)}, variance=${relevantChunks.length > 1 ? (topSimilarity - minSimilarity).toFixed(3) : 'N/A'} → ${confidence}%`)
  }
  
  return {
    context: context.trim(),
    sources,
    relevantChunks,
    confidence
  }
}

// Create context string for OpenAI prompt
export function createRAGContext(ragResult: RAGQueryResult): string {
  if (!ragResult.context.trim()) {
    return ''
  }
  
  const sourceList = ragResult.sources.length > 0 
    ? `\n\nSources: ${ragResult.sources.join(', ')}`
    : ''
  
  return `Based on the following information from uploaded documents:

${ragResult.context}${sourceList}

Please provide a detailed answer based on this context. If the context doesn't contain enough information to fully answer the question, please indicate what additional information might be needed.`
}

// Check if session has any documents
export async function sessionHasDocuments(sessionId: string): Promise<boolean> {
  try {
    console.log(`🔍 RAG - sessionHasDocuments called for session:`, sessionId)
    const session = await getSession(sessionId)
    console.log(`🔍 RAG - Found session:`, session ? {
      id: session.id,
      document_count: session.document_count,
      created_at: session.created_at,
      last_accessed: session.last_accessed
    } : 'null')
    
    const hasDocuments = session ? session.document_count > 0 : false
    console.log(`🔍 RAG - sessionHasDocuments returning:`, hasDocuments)
    return hasDocuments
  } catch (error) {
    console.error('🔍 RAG - Error checking session documents:', error)
    return false
  }
}

// Get session statistics
export async function getSessionStats(sessionId: string): Promise<{
  documentCount: number
  lastAccessed: Date
  createdAt: Date
} | null> {
  try {
    const session = await getSession(sessionId)
    if (!session) return null
    
    return {
      documentCount: session.document_count,
      lastAccessed: session.last_accessed,
      createdAt: session.created_at
    }
  } catch (error) {
    console.error('Error getting session stats:', error)
    return null
  }
}

// Clear embedding cache (useful for testing)
export function clearEmbeddingCache(): void {
  embeddingCache.clear()
}

// Get cache statistics
export function getCacheStats(): { size: number; maxSize: number } {
  return {
    size: embeddingCache.size,
    maxSize: 1000
  }
} 