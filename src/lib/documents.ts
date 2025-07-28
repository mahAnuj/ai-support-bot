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

// Extract text from file path (used when we have actual file paths)
export async function extractTextFromFilePath(filePath: string, fileName: string): Promise<string> {
  const fs = require('fs')
  
  try {
    console.log(`📄 Processing file: ${fileName}, path: ${filePath}`)
    
    if (fileName.toLowerCase().endsWith('.txt')) {
      // Handle plain text files
      return fs.readFileSync(filePath, 'utf8')
    } else if (fileName.toLowerCase().endsWith('.pdf')) {
      // Handle PDF files using fs.readFileSync (exactly like online examples)
      console.log('📖 Reading PDF with fs.readFileSync...')
      const dataBuffer = fs.readFileSync(filePath)
      
      // Use pdf-parse exactly like the documentation
      console.log('🔍 Parsing PDF with pdf-parse...')
      const pdfParse = require('pdf-parse')
      const data = await pdfParse(dataBuffer)
      
      if (!data || !data.text) {
        throw new Error('No text content found in PDF')
      }
      
      const extractedText = data.text.trim()
      if (extractedText.length === 0) {
        throw new Error('PDF appears to contain no readable text')
      }
      
      console.log(`✅ PDF text extracted: ${extractedText.length} characters from ${data.numpages} pages`)
      console.log(`📊 PDF info:`, data.info)
      
      return extractedText
    } else {
      throw new Error(`Unsupported file type: ${fileName}`)
    }
  } catch (error) {
    console.error(`❌ Error extracting text from ${fileName}:`, error)
    throw new Error(`Failed to extract text from ${fileName}: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
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
      // Handle PDF files using fs.readFileSync approach (like online examples)
      const fs = await import('fs')
      const path = await import('path')
      const os = await import('os')
      
      let tempFilePath: string | null = null
      
      try {
        console.log(`Processing PDF file: ${file.name}, size: ${file.size} bytes`)
        
        // Write File to temporary location first (like multer does)
        const arrayBuffer = await file.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        
        const tempDir = os.tmpdir()
        const tempFileName = `pdf-${Date.now()}-${Math.random().toString(36).substring(7)}.pdf`
        tempFilePath = path.join(tempDir, tempFileName)
        
        console.log(`Writing PDF to temporary file: ${tempFilePath}`)
        fs.writeFileSync(tempFilePath, buffer)
        
        // Now use fs.readFileSync exactly like online examples
        console.log('Reading PDF with fs.readFileSync...')
        const dataBuffer = fs.readFileSync(tempFilePath)
        
        // Use pdf-parse exactly like the documentation
        console.log('Parsing PDF with pdf-parse...')
        const pdfParse = require('pdf-parse')
        const data = await pdfParse(dataBuffer)
        
        if (!data || !data.text) {
          throw new Error('No text content found in PDF')
        }
        
        const extractedText = data.text.trim()
        if (extractedText.length === 0) {
          throw new Error('PDF appears to contain no readable text')
        }
        
        console.log(`PDF text extracted successfully: ${extractedText.length} characters from ${data.numpages} pages`)
        console.log(`PDF info:`, data.info)
        
        return extractedText
        
      } catch (pdfError) {
        console.error(`PDF parsing error for ${file.name}:`, pdfError)
        
        // Provide more specific error messages
        if (pdfError instanceof Error) {
          if (pdfError.message.includes('Invalid PDF') || pdfError.message.includes('PDF signature')) {
            throw new Error('The uploaded file does not appear to be a valid PDF.')
          } else if (pdfError.message.includes('Password') || pdfError.message.includes('encrypted')) {
            throw new Error('This PDF is password protected and cannot be processed.')
          } else if (pdfError.message.includes('no readable text') || pdfError.message.includes('No text content')) {
            throw new Error('This PDF appears to contain no readable text. It may be a scanned image or require OCR processing.')
          } else {
            throw new Error(`PDF parsing failed: ${pdfError.message}`)
          }
        } else {
          throw new Error('Unknown error occurred while processing PDF')
        }
      } finally {
        // Clean up temporary file
        if (tempFilePath) {
          try {
            console.log(`Cleaning up temporary file: ${tempFilePath}`)
            fs.unlinkSync(tempFilePath)
          } catch (cleanupError) {
            console.warn(`Failed to cleanup temporary file ${tempFilePath}:`, cleanupError)
          }
        }
      }
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

// Validate files by path (for formidable uploads)
export function validateFilePaths(filePaths: Array<{filepath: string, originalFilename: string, size: number, mimetype: string}>): { isValid: boolean; errors: string[] } {
  const errors: string[] = []
  const maxFileSize = 10 * 1024 * 1024 // 10MB
  const allowedTypes = ['text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  
  if (filePaths.length === 0) {
    errors.push('No files selected')
    return { isValid: false, errors }
  }
  
  if (filePaths.length > 5) {
    errors.push('You can upload a maximum of 5 files at once. Please select fewer files and try again.')
  }
  
  for (const file of filePaths) {
    if (!file || typeof file.size === 'undefined') {
      errors.push(`Invalid file object received`)
      continue
    }
    
    // Check file size
    if (file.size > maxFileSize) {
      errors.push(`${file.originalFilename} is too large (max 10MB)`)
    }
    
    // Check file type
    const isValidType = allowedTypes.includes(file.mimetype) || 
                       file.originalFilename.match(/\.(txt|pdf|docx)$/i)
    
    if (!isValidType) {
      errors.push(`Unsupported file type for ${file.originalFilename}. Please upload PDF, TXT, or DOCX files.`)
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
} 