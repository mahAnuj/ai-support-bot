import { NextRequest, NextResponse } from 'next/server'
import { validateFiles, extractTextFromFilePath } from '../../../lib/documents'
import { createSession, storeDocument } from '../../../lib/database'
import { getCachedEmbedding } from '../../../lib/rag'
import fs from 'fs'
import path from 'path'
import os from 'os'

export async function POST(request: NextRequest) {
  try {
    console.log('📤 Upload API called')
    const formData = await request.formData()
    const files = formData.getAll('files') as File[]
    
    console.log(`📂 Received ${files.length} files`)
    
    if (!files || files.length === 0) {
      console.log('❌ No files provided')
      return NextResponse.json(
        { error: 'No files provided' },
        { status: 400 }
      )
    }

    // Log file details for debugging
    files.forEach((file, index) => {
      console.log(`📄 File ${index + 1}: ${file.name}, size: ${file.size} bytes, type: ${file.type}`)
    })

    // Validate files first
    console.log('🔍 Validating files...')
    const validation = validateFiles(files)
    if (!validation.isValid) {
      console.log('❌ File validation failed:', validation.errors)
      return NextResponse.json(
        { error: 'File validation failed', details: validation.errors },
        { status: 400 }
      )
    }
    console.log('✅ File validation passed')

    // Convert File objects to file paths by writing them to temp directory
    const tempFiles: string[] = []
    const fileInfos: Array<{
      filePath: string
      originalName: string
      size: number
      type: string
    }> = []

    try {
      console.log('📁 Writing uploaded files to temporary directory...')
      
      for (const file of files) {
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        
        const tempDir = os.tmpdir()
        const tempFileName = `upload-${Date.now()}-${Math.random().toString(36).substring(7)}-${file.name}`
        const tempFilePath = path.join(tempDir, tempFileName)
        
        fs.writeFileSync(tempFilePath, buffer)
        tempFiles.push(tempFilePath)
        
        fileInfos.push({
          filePath: tempFilePath,
          originalName: file.name,
          size: file.size,
          type: file.type
        })
        
        console.log(`📄 Wrote ${file.name} to ${tempFilePath}`)
      }

      // Now process files using file paths (much simpler!)
      const processedDocs = []
      let totalWords = 0
      let totalChunks = 0

      for (const fileInfo of fileInfos) {
        try {
          console.log(`🔍 Processing ${fileInfo.originalName} from path ${fileInfo.filePath}`)
          
          // Use our new file path extraction function
          const extractedText = await extractTextFromFilePath(fileInfo.filePath, fileInfo.originalName)
          
          if (!extractedText.trim()) {
            console.warn(`No text content found in file: ${fileInfo.originalName}`)
            continue
          }

          // Simple chunking (reuse existing logic)
          const chunks = []
          const chunkSize = 1000
          for (let i = 0; i < extractedText.length; i += chunkSize) {
            chunks.push({
              content: extractedText.substring(i, i + chunkSize),
              index: chunks.length,
              source: fileInfo.originalName
            })
          }

          const wordCount = extractedText.split(/\s+/).length
          
          processedDocs.push({
            filename: fileInfo.originalName,
            content: extractedText,
            chunks,
            wordCount
          })

          totalWords += wordCount
          totalChunks += chunks.length
          
          console.log(`✅ Processed ${fileInfo.originalName}: ${wordCount} words, ${chunks.length} chunks`)
          
        } catch (error) {
          console.error(`❌ Error processing ${fileInfo.originalName}:`, error)
          throw error
        }
      }

      // Store the extracted content in the RAG system
      const { createSession, storeDocument, getSession } = await import('../../../lib/database')
      const { getCachedEmbedding } = await import('../../../lib/rag')
      
      // Check if sessionId was provided and exists, otherwise create new session
      const providedSessionId = formData.get('sessionId') as string
      let session
      
      if (providedSessionId) {
        console.log(`🔍 Checking for existing session: ${providedSessionId}`)
        const existingSession = await getSession(providedSessionId)
        
        if (existingSession) {
          console.log(`🔗 Using existing session: ${providedSessionId}`)
          session = existingSession
        } else {
          console.log(`❌ Session ${providedSessionId} not found, creating new one`)
          session = await createSession()
          console.log(`📝 Created new RAG session: ${session.id}`)
        }
      } else {
        // Create new session for RAG
        session = await createSession()
        console.log(`📝 Created RAG session: ${session.id}`)
      }
      
      // Store each processed document in the RAG system
      for (const doc of processedDocs) {
        try {
          console.log(`🔗 Storing ${doc.filename} in RAG system...`)
          
          // Generate embeddings for each chunk
          const chunksWithEmbeddings = []
          
          for (let i = 0; i < doc.chunks.length; i++) {
            const chunk = doc.chunks[i]
            const embedding = await getCachedEmbedding(chunk.content)
            
            chunksWithEmbeddings.push({
              content: chunk.content,
              embedding: embedding,
              index: i
            })
            
            // Small delay to respect rate limits
            if (i < doc.chunks.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 50))
            }
          }
          
          // Store document with embeddings in RAG database
          await storeDocument(session.id, doc.filename, chunksWithEmbeddings)
          console.log(`✅ Stored ${doc.filename} with ${chunksWithEmbeddings.length} chunks in RAG`)
          
        } catch (error) {
          console.error(`❌ Error storing ${doc.filename} in RAG:`, error)
          throw error
        }
      }
      
      return NextResponse.json({
        success: true,
        sessionId: session.id,
        message: `Successfully processed ${processedDocs.length} document(s)`,
        documents: processedDocs.map(doc => ({
          filename: doc.filename,
          chunks: doc.chunks.length,
          chunkCount: doc.chunks.length,
          wordCount: doc.wordCount
        })),
        details: {
          documentsProcessed: processedDocs.length,
          totalChunks: totalChunks,
          totalWords: totalWords
        }
      })

    } finally {
      // Clean up temporary files
      console.log('🗑️ Cleaning up temporary files...')
      for (const tempFile of tempFiles) {
        try {
          fs.unlinkSync(tempFile)
          console.log(`✅ Deleted ${tempFile}`)
        } catch (cleanupError) {
          console.warn(`⚠️ Failed to cleanup ${tempFile}:`, cleanupError)
        }
      }
    }
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