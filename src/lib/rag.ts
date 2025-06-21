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

// Get cached embedding or generate new one
async function getCachedEmbedding(text: string): Promise<number[]> {
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
      
      // Chunk the text with optimized parameters
      const chunks = chunkText(extractedText, 600, 100) // Smaller chunks for better retrieval
      
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
  similarityThreshold: number = 0.5 // Lowered threshold for better recall
): Promise<RAGQueryResult> {
  // Check if session exists and update access time
  const session = await getSession(sessionId)
  if (!session) {
    throw new Error('Session not found')
  }
  
  await updateSessionAccess(sessionId)
  
  // Generate embedding for the query with caching
  const queryEmbedding = await getCachedEmbedding(query)
  
  // Find relevant chunks
  console.log(`RAG Query - Searching for chunks in session: ${sessionId}`)
  const relevantChunks = await findRelevantChunks({
    session_id: sessionId,
    query_embedding: queryEmbedding,
    similarity_threshold: similarityThreshold,
    max_results: maxResults
  })
  console.log(`RAG Query - Found ${relevantChunks.length} relevant chunks`)
  
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
  
  // Calculate confidence based on similarity scores and number of results
  const avgSimilarity = relevantChunks.length > 0 
    ? relevantChunks.reduce((sum, chunk) => sum + chunk.similarity, 0) / relevantChunks.length
    : 0
  
  // Improved confidence calculation
  let confidence = Math.round(avgSimilarity * 100)
  
  // Boost confidence if we have multiple relevant chunks
  if (relevantChunks.length >= 3) {
    confidence = Math.min(95, confidence + 10)
  } else if (relevantChunks.length >= 2) {
    confidence = Math.min(90, confidence + 5)
  }
  
  // Ensure minimum confidence for any results
  if (relevantChunks.length > 0) {
    confidence = Math.max(confidence, 40)
  } else {
    confidence = 30
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