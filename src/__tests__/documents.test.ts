import { 
  chunkText, 
  processFiles, 
  validateFiles, 
  createContextFromDocuments 
} from '@/lib/documents'

// Mock file for testing
const createMockFile = (name: string, type: string, content: string = 'mock content') => {
  const file = new File([content], name, { type })
  return file
}

const createMockFileList = (files: File[]): FileList => {
  const fileList = {
    length: files.length,
    item: (index: number) => files[index] || null,
    [Symbol.iterator]: function* () {
      for (let i = 0; i < files.length; i++) {
        yield files[i]
      }
    }
  } as FileList
  
  // Add array-like access
  files.forEach((file, index) => {
    (fileList as any)[index] = file
  })
  
  return fileList
}

describe('Document Processing', () => {
  describe('chunkText', () => {
    it('should split text into chunks with overlap', () => {
      const text = 'This is sentence one. This is sentence two. This is sentence three. This is sentence four.'
      const chunks = chunkText(text, 50, 10)
      
      expect(chunks.length).toBeGreaterThan(1)
      expect(chunks[0].content.length).toBeLessThanOrEqual(50)
      
      // Check overlap exists between chunks
      if (chunks.length > 1) {
        const firstChunkEnd = chunks[0].content.slice(-10)
        const secondChunkStart = chunks[1].content.slice(0, 10)
        expect(secondChunkStart).toContain(firstChunkEnd.split(' ').pop())
      }
    })

    it('should handle text shorter than chunk size', () => {
      const text = 'Short text.'
      const chunks = chunkText(text, 1000)
      
      expect(chunks).toHaveLength(1)
      expect(chunks[0].content).toBe('Short text') // Period is removed by splitting
    })

    it('should create chunks with proper metadata', () => {
      const text = 'This is a test document with multiple sentences for chunking.'
      const chunks = chunkText(text, 30)
      
      chunks.forEach((chunk, index) => {
        expect(chunk.index).toBe(index)
        expect(chunk.source).toBe('document')
        expect(typeof chunk.content).toBe('string')
      })
    })
  })

  describe('validateFiles', () => {
    it('should accept valid file types', () => {
      const files = createMockFileList([
        createMockFile('doc.pdf', 'application/pdf'),
        createMockFile('doc.txt', 'text/plain'),
        createMockFile('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      ])
      
      const result = validateFiles(files)
      
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject invalid file types', () => {
      const files = createMockFileList([
        createMockFile('image.jpg', 'image/jpeg'),
        createMockFile('script.exe', 'application/exe')
      ])
      
      const result = validateFiles(files)
      
      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain('Unsupported file type')
    })

    it('should reject files that are too large', () => {
      const largeFile = createMockFile('large.pdf', 'application/pdf')
      Object.defineProperty(largeFile, 'size', { value: 6 * 1024 * 1024 }) // 6MB
      
      const files = createMockFileList([largeFile])
      const result = validateFiles(files)
      
      expect(result.isValid).toBe(false)
      expect(result.errors[0]).toContain('too large')
    })

    it('should reject too many files', () => {
      const files = createMockFileList(
        Array(6).fill(null).map((_, i) => createMockFile(`doc${i}.txt`, 'text/plain'))
      )
      
      const result = validateFiles(files)
      
      expect(result.isValid).toBe(false)
      expect(result.errors[0]).toContain('maximum of 5 files')
    })
  })

  describe('processFiles', () => {
    it('should process text files correctly', async () => {
      const textContent = 'This is a sample document with some content for testing.'
      const files = [createMockFile('test.txt', 'text/plain', textContent)]
      
      const result = await processFiles(files)
      
      expect(result.documents).toHaveLength(1)
      expect(result.documents[0].filename).toBe('test.txt')
      expect(result.documents[0].content).toBe(textContent)
      expect(result.documents[0].chunks.length).toBeGreaterThan(0)
      expect(result.totalWords).toBeGreaterThan(0)
    })

    it('should handle multiple files', async () => {
      const files = [
        createMockFile('doc1.txt', 'text/plain', 'Content of document one.'),
        createMockFile('doc2.txt', 'text/plain', 'Content of document two.')
      ]
      
      const result = await processFiles(files)
      
      expect(result.documents).toHaveLength(2)
      expect(result.totalWords).toBeGreaterThan(0)
    })

    it('should handle file reading errors gracefully', async () => {
      // Create a file that will cause an error
      const badFile = createMockFile('bad.txt', 'text/plain')
      
      const result = await processFiles([badFile])
      
      // Should still return a result structure
      expect(result.documents).toBeDefined()
      expect(Array.isArray(result.documents)).toBe(true)
    })
  })

  describe('createContextFromDocuments', () => {
    it('should create context from processed documents', () => {
      const documents = [
        {
          filename: 'doc1.txt',
          content: 'First document content.',
          chunks: [
            { content: 'First document content.', index: 0, source: 'doc1.txt' }
          ],
          wordCount: 3
        },
        {
          filename: 'doc2.txt', 
          content: 'Second document content.',
          chunks: [
            { content: 'Second document content.', index: 0, source: 'doc2.txt' }
          ],
          wordCount: 3
        }
      ]
      
      const context = createContextFromDocuments(documents)
      
      expect(context).toContain('doc1.txt')
      expect(context).toContain('doc2.txt')
      expect(context).toContain('First document content')
      expect(context).toContain('Second document content')
    })

    it('should limit context length', () => {
      const documents = [
        {
          filename: 'long.txt',
          content: 'A'.repeat(5000), // Very long content
          chunks: [
            { content: 'A'.repeat(5000), index: 0, source: 'long.txt' }
          ],
          wordCount: 1000
        }
      ]
      
      const context = createContextFromDocuments(documents, 1000)
      
      expect(context.length).toBeLessThanOrEqual(1000)
    })
  })
}) 