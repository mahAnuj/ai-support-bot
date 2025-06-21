export interface ProcessedDocument {
  filename: string
  content: string
  chunks: DocumentChunk[]
  wordCount: number
}

export interface DocumentChunk {
  content: string
  index: number
  source: string
}

// Extract text from different file types
export async function extractTextFromFile(file: File): Promise<string> {
  const fileType = file.type.toLowerCase()
  const fileName = file.name.toLowerCase()
  
  try {
    if (fileType.includes('text/plain') || fileName.endsWith('.txt')) {
      // Handle plain text files
      return await file.text()
    } else if (fileType.includes('application/pdf') || fileName.endsWith('.pdf')) {
      // Temporarily disable PDF parsing while we resolve library issues
      throw new Error('PDF parsing is temporarily disabled. Please upload a TXT or DOCX file instead. We are working to restore PDF support soon.')
    } else if (fileType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') || fileName.endsWith('.docx')) {
      // For DOCX files, we'll do basic text extraction
      // In production, you'd want to use mammoth.js or similar
      const text = await file.text()
      // Basic cleanup for DOCX files (remove XML tags)
      return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    } else {
      // Fallback for unknown file types
      const text = await file.text()
      return text
    }
  } catch (error) {
    console.error(`Error extracting text from ${file.name}:`, error)
    throw new Error(`Failed to extract text from ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Chunk text into smaller pieces for better RAG performance
export function chunkText(text: string, maxChunkSize: number = 600, overlap: number = 100): DocumentChunk[] {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0)
  const chunks: DocumentChunk[] = []
  let currentChunk = ''
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim()
    if (!trimmedSentence) continue
    
    // If adding this sentence would exceed the chunk size, start a new chunk
    if (currentChunk.length + trimmedSentence.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        index: chunks.length,
        source: 'document'
      })
      
      // Start new chunk with overlap from previous chunk
      const words = currentChunk.split(' ')
      const overlapWords = words.slice(-Math.floor(overlap / 10)) // Approximate overlap
      currentChunk = overlapWords.join(' ') + ' ' + trimmedSentence
    } else {
      currentChunk += (currentChunk ? '. ' : '') + trimmedSentence
    }
  }
  
  // Add the last chunk if it has content
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      index: chunks.length,
      source: 'document'
    })
  }
  
  // If no chunks were created, return the original text as a single chunk
  if (chunks.length === 0 && text.trim()) {
    chunks.push({
      content: text.trim(),
      index: 0,
      source: 'document'
    })
  }
  
  return chunks
}

// Process uploaded files into structured format
export async function processFiles(files: File[]): Promise<{ documents: ProcessedDocument[]; totalWords: number; totalChunks: number }> {
  const processedDocs: ProcessedDocument[] = []
  let totalWords = 0
  let totalChunks = 0
  
  for (const file of files) {
    try {
      console.log(`Processing file: ${file.name} (${file.type})`)
      
      // Extract text based on file type
      const extractedText = await extractTextFromFile(file)
      
      // Clean and validate text
      const cleanText = extractedText.trim()
      if (!cleanText) {
        console.warn(`No text content found in file: ${file.name}`)
        continue
      }
      
      console.log(`Extracted ${cleanText.length} characters from ${file.name}`)
      
      // Chunk the text
      const chunks = chunkText(cleanText)
      
      // Calculate word count
      const wordCount = cleanText.split(/\s+/).length
      
      processedDocs.push({
        filename: file.name,
        content: cleanText,
        chunks,
        wordCount
      })
      
      totalWords += wordCount
      totalChunks += chunks.length
      
      console.log(`Processed ${file.name}: ${wordCount} words, ${chunks.length} chunks`)
      
    } catch (error) {
      console.error(`Error processing file ${file.name}:`, error)
      throw new Error(`Failed to process ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
  
  return {
    documents: processedDocs,
    totalWords,
    totalChunks
  }
}

// Create context string from processed documents for RAG
export function createContextFromDocuments(docs: ProcessedDocument[], maxContextLength: number = 3000): string {
  let context = ''
  
  for (const doc of docs) {
    const docHeader = `--- From ${doc.filename} ---\n`
    
    // Add chunks until we reach the context limit
    for (const chunk of doc.chunks) {
      const addition = docHeader + chunk.content + '\n'
      
      if (context.length + addition.length > maxContextLength) {
        break
      }
      
      context += addition
    }
    
    if (context.length > maxContextLength) {
      break
    }
  }
  
  return context.trim()
}

// Validate file types and sizes
export function validateFiles(files: File[] | FileList): { isValid: boolean; errors: string[] } {
  const errors: string[] = []
  const maxFileSize = 10 * 1024 * 1024 // 10MB (increased for PDFs)
  const allowedTypes = ['text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  
  if (files.length === 0) {
    errors.push('No files selected')
    return { isValid: false, errors }
  }
  
  if (files.length > 5) {
    errors.push('You can upload a maximum of 5 files at once. Please select fewer files and try again.')
  }
  
  // Convert to array if FileList
  const fileArray = Array.from(files)
  
  for (const file of fileArray) {
    // Check if file is actually a File object
    if (!file || typeof file.size === 'undefined') {
      errors.push(`Invalid file object received`)
      continue
    }
    
    // Check file size
    if (file.size > maxFileSize) {
      errors.push(`${file.name} is too large (max 10MB)`)
    }
    
    // Check file type
    const isValidType = allowedTypes.includes(file.type) || 
                       file.name.match(/\.(txt|pdf|docx)$/i)
    
    if (!isValidType) {
      errors.push(`Unsupported file type for ${file.name}. Please upload PDF, TXT, or DOCX files.`)
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
} 