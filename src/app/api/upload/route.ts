import { NextRequest, NextResponse } from 'next/server'
import { validateFiles, extractTextFromFilePath } from '../../../lib/documents'
import { getCachedEmbedding } from '../../../lib/rag'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { clientIp, isRateLimited } from '../../../lib/guard'
import { resolveBuilderStore, storageErrorResponse } from '../../../lib/storage/resolve'
import { StorageError, isStorageError, safeErrorSummary } from '../../../lib/storage/errors'

export async function POST(request: NextRequest) {
  try {
    console.log('📤 Upload API called')
    // Uploads are embedded on this server, so each one spends its CPU and memory
    if (isRateLimited(`upload:${clientIp(request)}`, 10)) {
      return NextResponse.json({ error: 'Too many uploads' }, { status: 429 })
    }
    // Resolved before the body is read, so a bad or wrong-purpose token reads and writes nothing
    const resolved = resolveBuilderStore(request)
    if (!resolved.ok) return storageErrorResponse(resolved.error)
    const ctx = resolved.ctx
    const store = ctx.store
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
        
        // The uploaded name is attacker-controlled: "../../x" would escape the
        // temp directory, and the cleanup below would then delete that path.
        // Build the path from a random ID and a checked extension only.
        const extension = path.extname(path.basename(file.name)).toLowerCase()
        const safeExtension = ['.txt', '.md', '.pdf', '.docx'].includes(extension) ? extension : ''
        const tempFilePath = path.join(os.tmpdir(), `upload-${crypto.randomUUID()}${safeExtension}`)
        
        fs.writeFileSync(tempFilePath, buffer)
        tempFiles.push(tempFilePath)
        
        fileInfos.push({
          filePath: tempFilePath,
          originalName: path.basename(file.name),
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

      // Check if sessionId was provided and exists, otherwise create new session
      const providedSessionId = formData.get('sessionId') as string
      let session
      
      if (ctx.kind === 'postgres') {
        // The token decides the workspace; a sessionId in the form is ignored
        session = await store.getWorkspace(ctx.workspaceId)
        if (!session) throw new StorageError('workspace_not_found')
        console.log(`🔗 Using workspace ${ctx.label}`)
      } else if (providedSessionId) {
        console.log(`🔍 Checking for existing session: ${providedSessionId}`)
        const existingSession = await store.getWorkspace(providedSessionId)
        
        if (existingSession) {
          console.log(`🔗 Using existing session: ${providedSessionId}`)
          session = existingSession
        } else {
          console.log(`❌ Session ${providedSessionId} not found, creating new one`)
          session = await store.createWorkspace()
          console.log(`📝 Created new RAG session: ${session.id}`)
        }
      } else {
        // Create new session for RAG
        session = await store.createWorkspace()
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
          await store.storeDocument(session.id, doc.filename, chunksWithEmbeddings)
          console.log(`✅ Stored ${doc.filename} with ${chunksWithEmbeddings.length} chunks in RAG`)
          
        } catch (error) {
          console.error(`❌ Error storing ${doc.filename} in RAG:`, isStorageError(error) ? safeErrorSummary(error) : error)
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
    if (isStorageError(error)) {
      console.error(`Upload API storage error ${safeErrorSummary(error)}`)
      return storageErrorResponse(error)
    }
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