import { NextRequest, NextResponse } from 'next/server'
import { getDatabaseStats, getInMemoryDatabase } from '../../../lib/database'

export async function GET() {
  try {
    const stats = await getDatabaseStats()
    const db = getInMemoryDatabase()
    
    // Get all sessions
    const sessions = Array.from(db.sessions.values()).map(session => ({
      id: session.id,
      created_at: session.created_at,
      last_accessed: session.last_accessed,
      document_count: session.document_count
    }))
    
    // Get all documents
    const documents = Array.from(db.documents.values())
    
    // Get session-document mappings
    const sessionDocuments = Array.from(db.sessionDocuments.entries()).map(([sessionId, documentIds]) => ({
      sessionId,
      documentIds,
      documentCount: documentIds.length
    }))
    
    // Get document-chunk mappings
    const documentChunks = Array.from(db.documentChunks.entries()).map(([documentId, chunkIds]) => ({
      documentId,
      chunkCount: chunkIds.length
    }))

    // Get sample chunk content for debugging
    const sampleChunks = Array.from(db.chunks.values()).slice(0, 5).map(chunk => ({
      id: chunk.id,
      document_id: chunk.document_id,
      content_preview: chunk.content.substring(0, 200) + '...',
      embedding_length: chunk.embedding ? chunk.embedding.length : 0,
      embedding_sample: chunk.embedding ? chunk.embedding.slice(0, 5) : null,
      chunk_index: chunk.chunk_index
    }))
    
    return NextResponse.json({
      stats,
      sessions,
      documents,
      sessionDocuments,
      documentChunks,
      sampleChunks,
      totalSessions: db.sessions.size,
      totalDocuments: db.documents.size,
      totalChunks: db.chunks.size,
      databaseCreatedAt: db.createdAt.toISOString(),
      currentTime: new Date().toISOString()
    })
  } catch (error) {
    console.error('Debug API error:', error)
    return NextResponse.json(
      { error: 'Failed to get debug information', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const { clearCache, clearDatabase } = await request.json()
    
    if (clearCache) {
      // Import and clear the embedding cache
      const { clearEmbeddingCache, getCacheStats } = await import('../../../lib/rag')
      
      const beforeStats = getCacheStats()
      clearEmbeddingCache()
      const afterStats = getCacheStats()
      
      return NextResponse.json({
        message: 'Embedding cache cleared successfully',
        beforeStats,
        afterStats,
        cleared: true
      })
    }
    
    if (clearDatabase) {
      // Clear the entire in-memory database
      const db = getInMemoryDatabase()
      
      const beforeStats = {
        sessions: db.sessions.size,
        documents: db.documents.size,
        chunks: db.chunks.size
      }
      
      // Clear all data
      db.sessions.clear()
      db.documents.clear()
      db.chunks.clear()
      db.sessionDocuments.clear()
      db.documentChunks.clear()
      
      const afterStats = {
        sessions: db.sessions.size,
        documents: db.documents.size,
        chunks: db.chunks.size
      }
      
      return NextResponse.json({
        message: 'Database cleared successfully',
        beforeStats,
        afterStats,
        cleared: true
      })
    }
    
    return NextResponse.json({ error: 'No valid action specified' }, { status: 400 })
  } catch (error) {
    console.error('Debug POST API error:', error)
    return NextResponse.json(
      { error: 'Failed to process debug action', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
} 