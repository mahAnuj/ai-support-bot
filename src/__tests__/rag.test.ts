import {
  processDocumentsForRAG,
  queryRAG,
  createRAGContext,
  sessionHasDocuments,
  getSessionStats
} from '../lib/rag'
import type { RAGProcessResult, RAGQueryResult } from '../lib/rag'
import type { DemoSession, VectorSearchResult } from '../types/database'

// Mock all dependencies
jest.mock('../lib/openai')
jest.mock('../lib/documents')
jest.mock('../lib/database')

const mockOpenAI = require('../lib/openai')
const mockDocuments = require('../lib/documents')
const mockDatabase = require('../lib/database')

describe('RAG Service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    
    // Setup default mocks
    mockOpenAI.generateEmbeddings.mockResolvedValue([0.1, 0.2, 0.3, 0.4, 0.5])
    mockDocuments.extractTextFromFile.mockReturnValue('Extracted text content')
    mockDocuments.chunkText.mockReturnValue([
      { content: 'First chunk of text', index: 0 },
      { content: 'Second chunk of text', index: 1 }
    ])
  })

  describe('Document Processing', () => {
    it('should process documents and store in vector database', async () => {
      const mockSession: DemoSession = {
        id: 'session-123',
        created_at: new Date(),
        last_accessed: new Date(),
        document_count: 0
      }

      const mockFiles = [
        new File(['Test content 1'], 'test1.txt', { type: 'text/plain' }),
        new File(['Test content 2'], 'test2.txt', { type: 'text/plain' })
      ]

      mockDatabase.createSession.mockResolvedValue(mockSession)
      mockDatabase.storeDocument.mockResolvedValue({
        document: { id: 'doc-1', filename: 'test1.txt' },
        chunks: []
      })

      const result = await processDocumentsForRAG(mockFiles)

      expect(mockDatabase.createSession).toHaveBeenCalled()
      expect(mockDocuments.extractTextFromFile).toHaveBeenCalledTimes(2)
      expect(mockDocuments.chunkText).toHaveBeenCalledTimes(2)
      expect(mockOpenAI.generateEmbeddings).toHaveBeenCalledTimes(4) // 2 chunks per file
      expect(mockDatabase.storeDocument).toHaveBeenCalledTimes(2)
      
      expect(result).toEqual({
        sessionId: 'session-123',
        documentsProcessed: 2,
        totalChunks: 4, // 2 chunks per file
        totalWords: 6 // 3 words per extracted text
      })
    })

    it('should handle file processing errors', async () => {
      const mockSession: DemoSession = {
        id: 'session-123',
        created_at: new Date(),
        last_accessed: new Date(),
        document_count: 0
      }

      const mockFiles = [
        new File(['Test content'], 'test.txt', { type: 'text/plain' })
      ]

      mockDatabase.createSession.mockResolvedValue(mockSession)
      mockDocuments.extractTextFromFile.mockImplementation(() => {
        throw new Error('File extraction failed')
      })

      await expect(processDocumentsForRAG(mockFiles)).rejects.toThrow(
        'Failed to process file test.txt: File extraction failed'
      )
    })

    it('should use correct chunk size and overlap', async () => {
      const mockSession: DemoSession = {
        id: 'session-123',
        created_at: new Date(),
        last_accessed: new Date(),
        document_count: 0
      }

      const mockFiles = [
        new File(['Test content'], 'test.txt', { type: 'text/plain' })
      ]

      mockDatabase.createSession.mockResolvedValue(mockSession)
      mockDatabase.storeDocument.mockResolvedValue({
        document: { id: 'doc-1', filename: 'test.txt' },
        chunks: []
      })

      await processDocumentsForRAG(mockFiles)

      expect(mockDocuments.chunkText).toHaveBeenCalledWith(
        'Extracted text content',
        800, // chunk size
        100  // overlap
      )
    })
  })

  describe('RAG Querying', () => {
    it('should query RAG system and return relevant context', async () => {
      const mockSession: DemoSession = {
        id: 'session-123',
        created_at: new Date(),
        last_accessed: new Date(),
        document_count: 1
      }

      const mockChunks: VectorSearchResult[] = [
        {
          content: 'Vacation policy allows 2 weeks per year',
          filename: 'hr-policy.txt',
          similarity: 0.85,
          chunk_index: 0,
          document_id: 'doc-1'
        },
        {
          content: 'Vacation requests must be submitted 2 weeks in advance',
          filename: 'hr-policy.txt',
          similarity: 0.78,
          chunk_index: 1,
          document_id: 'doc-1'
        }
      ]

      mockDatabase.getSession.mockResolvedValue(mockSession)
      mockDatabase.updateSessionAccess.mockResolvedValue()
      mockDatabase.findRelevantChunks.mockResolvedValue(mockChunks)

      const result = await queryRAG('session-123', 'What is the vacation policy?')

      expect(mockDatabase.getSession).toHaveBeenCalledWith('session-123')
      expect(mockDatabase.updateSessionAccess).toHaveBeenCalledWith('session-123')
      expect(mockOpenAI.generateEmbeddings).toHaveBeenCalledWith('What is the vacation policy?')
      expect(mockDatabase.findRelevantChunks).toHaveBeenCalledWith({
        session_id: 'session-123',
        query_embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
        similarity_threshold: 0.7,
        max_results: 5
      })

      expect(result).toEqual({
        context: 'Vacation policy allows 2 weeks per year\n\nVacation requests must be submitted 2 weeks in advance',
        sources: ['hr-policy.txt'],
        relevantChunks: mockChunks,
        confidence: 82 // Average of 85 and 78 = 81.5, rounded to 82
      })
    })

    it('should handle non-existent session', async () => {
      mockDatabase.getSession.mockResolvedValue(null)

      await expect(queryRAG('non-existent', 'test query')).rejects.toThrow('Session not found')
    })

    it('should use custom parameters for search', async () => {
      const mockSession: DemoSession = {
        id: 'session-123',
        created_at: new Date(),
        last_accessed: new Date(),
        document_count: 1
      }

      mockDatabase.getSession.mockResolvedValue(mockSession)
      mockDatabase.updateSessionAccess.mockResolvedValue()
      mockDatabase.findRelevantChunks.mockResolvedValue([])

      await queryRAG('session-123', 'test query', 10, 0.8)

      expect(mockDatabase.findRelevantChunks).toHaveBeenCalledWith({
        session_id: 'session-123',
        query_embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
        similarity_threshold: 0.8,
        max_results: 10
      })
    })

    it('should handle empty search results', async () => {
      const mockSession: DemoSession = {
        id: 'session-123',
        created_at: new Date(),
        last_accessed: new Date(),
        document_count: 1
      }

      mockDatabase.getSession.mockResolvedValue(mockSession)
      mockDatabase.updateSessionAccess.mockResolvedValue()
      mockDatabase.findRelevantChunks.mockResolvedValue([])

      const result = await queryRAG('session-123', 'non-matching query')

      expect(result).toEqual({
        context: '',
        sources: [],
        relevantChunks: [],
        confidence: 30 // Minimum confidence
      })
    })

    it('should calculate confidence correctly', async () => {
      const mockSession: DemoSession = {
        id: 'session-123',
        created_at: new Date(),
        last_accessed: new Date(),
        document_count: 1
      }

      const mockChunks: VectorSearchResult[] = [
        {
          content: 'High similarity content',
          filename: 'test.txt',
          similarity: 0.95,
          chunk_index: 0,
          document_id: 'doc-1'
        }
      ]

      mockDatabase.getSession.mockResolvedValue(mockSession)
      mockDatabase.updateSessionAccess.mockResolvedValue()
      mockDatabase.findRelevantChunks.mockResolvedValue(mockChunks)

      const result = await queryRAG('session-123', 'test query')

      expect(result.confidence).toBe(95) // Should cap at 95
    })
  })

  describe('Context Creation', () => {
    it('should create formatted context with sources', () => {
      const ragResult: RAGQueryResult = {
        context: 'Vacation policy content\n\nMore policy details',
        sources: ['hr-policy.txt', 'employee-handbook.pdf'],
        relevantChunks: [],
        confidence: 85
      }

      const context = createRAGContext(ragResult)

      expect(context).toContain('Based on the following information from uploaded documents:')
      expect(context).toContain('Vacation policy content')
      expect(context).toContain('More policy details')
      expect(context).toContain('Sources: hr-policy.txt, employee-handbook.pdf')
      expect(context).toContain('Please provide a detailed answer based on this context')
    })

    it('should handle empty context', () => {
      const ragResult: RAGQueryResult = {
        context: '',
        sources: [],
        relevantChunks: [],
        confidence: 30
      }

      const context = createRAGContext(ragResult)

      expect(context).toBe('')
    })

    it('should handle context without sources', () => {
      const ragResult: RAGQueryResult = {
        context: 'Some content',
        sources: [],
        relevantChunks: [],
        confidence: 50
      }

      const context = createRAGContext(ragResult)

      expect(context).toContain('Some content')
      expect(context).not.toContain('Sources:')
    })
  })

  describe('Session Utilities', () => {
    it('should check if session has documents', async () => {
      const mockSession: DemoSession = {
        id: 'session-123',
        created_at: new Date(),
        last_accessed: new Date(),
        document_count: 2
      }

      mockDatabase.getSession.mockResolvedValue(mockSession)

      const result = await sessionHasDocuments('session-123')

      expect(result).toBe(true)
      expect(mockDatabase.getSession).toHaveBeenCalledWith('session-123')
    })

    it('should return false for session without documents', async () => {
      const mockSession: DemoSession = {
        id: 'session-123',
        created_at: new Date(),
        last_accessed: new Date(),
        document_count: 0
      }

      mockDatabase.getSession.mockResolvedValue(mockSession)

      const result = await sessionHasDocuments('session-123')

      expect(result).toBe(false)
    })

    it('should return false for non-existent session', async () => {
      mockDatabase.getSession.mockResolvedValue(null)

      const result = await sessionHasDocuments('non-existent')

      expect(result).toBe(false)
    })

    it('should handle database errors gracefully', async () => {
      mockDatabase.getSession.mockRejectedValue(new Error('Database error'))

      const result = await sessionHasDocuments('session-123')

      expect(result).toBe(false)
    })

    it('should get session statistics', async () => {
      const mockSession: DemoSession = {
        id: 'session-123',
        created_at: new Date('2024-01-01'),
        last_accessed: new Date('2024-01-02'),
        document_count: 3
      }

      mockDatabase.getSession.mockResolvedValue(mockSession)

      const result = await getSessionStats('session-123')

      expect(result).toEqual({
        documentCount: 3,
        lastAccessed: new Date('2024-01-02'),
        createdAt: new Date('2024-01-01')
      })
    })

    it('should return null for non-existent session stats', async () => {
      mockDatabase.getSession.mockResolvedValue(null)

      const result = await getSessionStats('non-existent')

      expect(result).toBeNull()
    })

    it('should handle stats errors gracefully', async () => {
      mockDatabase.getSession.mockRejectedValue(new Error('Database error'))

      const result = await getSessionStats('session-123')

      expect(result).toBeNull()
    })
  })
}) 