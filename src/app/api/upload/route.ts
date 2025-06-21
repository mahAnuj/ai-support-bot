import { NextRequest, NextResponse } from 'next/server'
import { processDocumentsForRAG } from '../../../lib/rag'
import { validateFiles } from '../../../lib/documents'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const files = formData.getAll('files') as File[]
    
    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: 'No files provided' },
        { status: 400 }
      )
    }

    // Validate files
    const validation = validateFiles(files)
    if (!validation.isValid) {
      return NextResponse.json(
        { error: 'File validation failed', details: validation.errors },
        { status: 400 }
      )
    }

    // Process files using RAG system
    const result = await processDocumentsForRAG(files)
    
    return NextResponse.json({
      success: true,
      sessionId: result.sessionId,
      message: `Successfully processed ${result.documentsProcessed} document(s)`,
      details: {
        documentsProcessed: result.documentsProcessed,
        totalChunks: result.totalChunks,
        totalWords: result.totalWords
      }
    })
  } catch (error) {
    console.error('Upload API error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to process files', 
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