import {
  initializeDatabase,
  getDatabase,
  closeDatabase,
  setupDatabase,
  createSession,
  getSession,
  updateSessionAccess,
  storeDocument,
  findRelevantChunks,
  getSessionDocuments,
  cleanupOldSessions
} from '../lib/database'
import type { DemoSession, VectorSearchResult } from '../types/database'

// Mock pg module
jest.mock('pg', () => {
  const mockQuery = jest.fn()
  const mockConnect = jest.fn()
  const mockEnd = jest.fn()
  const mockRelease = jest.fn()
  
  const mockClient = {
    query: mockQuery,
    release: mockRelease
  }
  
  const mockPool = {
    query: mockQuery,
    connect: jest.fn().mockResolvedValue(mockClient),
    end: mockEnd
  }
  
  return {
    Pool: jest.fn().mockImplementation(() => mockPool),
    __mockQuery: mockQuery,
    __mockConnect: mockConnect,
    __mockEnd: mockEnd,
    __mockRelease: mockRelease,
    __mockPool: mockPool,
    __mockClient: mockClient
  }
})

const pg = require('pg')

describe('Database Operations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reset any existing pool
    require('../lib/database').__resetPool?.()
  })

  afterEach(async () => {
    await closeDatabase()
  })

  describe('Database Connection', () => {
    it('should initialize database connection with correct config', () => {
      const originalEnv = process.env
      process.env = {
        ...originalEnv,
        DB_HOST: 'test-host',
        DB_PORT: '5433',
        DB_NAME: 'test-db',
        DB_USER: 'test-user',
        DB_PASSWORD: 'test-pass'
      }

      initializeDatabase()

      expect(pg.Pool).toHaveBeenCalledWith({
        host: 'test-host',
        port: 5433,
        database: 'test-db',
        user: 'test-user',
        password: 'test-pass',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      })

      process.env = originalEnv
    })

    it('should use default config when env vars not set', () => {
      const originalEnv = process.env
      process.env = { ...originalEnv }
      delete process.env.DB_HOST
      delete process.env.DB_PORT
      delete process.env.DB_NAME
      delete process.env.DB_USER
      delete process.env.DB_PASSWORD

      initializeDatabase()

      expect(pg.Pool).toHaveBeenCalledWith({
        host: 'localhost',
        port: 5432,
        database: 'ai_support_bot',
        user: 'postgres',
        password: 'password',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      })

      process.env = originalEnv
    })

    it('should reuse existing connection pool', () => {
      const pool1 = initializeDatabase()
      const pool2 = getDatabase()
      
      expect(pool1).toBe(pool2)
      expect(pg.Pool).toHaveBeenCalledTimes(1)
    })

    it('should close database connection', async () => {
      initializeDatabase()
      await closeDatabase()
      
      expect(pg.__mockEnd).toHaveBeenCalled()
    })
  })

  describe('Database Setup', () => {
    it('should create all required tables and extensions', async () => {
      pg.__mockQuery.mockResolvedValue({ rows: [] })
      
      await setupDatabase()
      
      // Should enable pgvector extension
      expect(pg.__mockQuery).toHaveBeenCalledWith('CREATE EXTENSION IF NOT EXISTS vector')
      
      // Should create demo_sessions table
      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS demo_sessions')
      )
      
      // Should create session_documents table
      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS session_documents')
      )
      
      // Should create document_chunks table with vector column
      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS document_chunks')
      )
      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('embedding VECTOR(1536)')
      )
      
      // Should create vector index
      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx')
      )
    })

    it('should handle database setup errors', async () => {
      const error = new Error('Database connection failed')
      pg.__mockQuery.mockRejectedValue(error)
      
      await expect(setupDatabase()).rejects.toThrow('Database connection failed')
    })
  })

  describe('Session Management', () => {
    it('should create a new session', async () => {
      const mockSession: DemoSession = {
        id: 'session-123',
        created_at: new Date(),
        last_accessed: new Date(),
        document_count: 0
      }
      
      pg.__mockQuery.mockResolvedValue({ rows: [mockSession] })
      
      const result = await createSession()
      
      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO demo_sessions')
      )
      expect(result).toEqual(mockSession)
    })

    it('should get session by ID', async () => {
      const mockSession: DemoSession = {
        id: 'session-123',
        created_at: new Date(),
        last_accessed: new Date(),
        document_count: 2
      }
      
      pg.__mockQuery.mockResolvedValue({ rows: [mockSession] })
      
      const result = await getSession('session-123')
      
      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, created_at, last_accessed, document_count'),
        ['session-123']
      )
      expect(result).toEqual(mockSession)
    })

    it('should return null for non-existent session', async () => {
      pg.__mockQuery.mockResolvedValue({ rows: [] })
      
      const result = await getSession('non-existent')
      
      expect(result).toBeNull()
    })

    it('should update session access time', async () => {
      pg.__mockQuery.mockResolvedValue({ rows: [] })
      
      await updateSessionAccess('session-123')
      
      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE demo_sessions'),
        ['session-123']
      )
    })
  })

  describe('Document Storage', () => {
    it('should store document with chunks and embeddings', async () => {
      const mockDocument = {
        id: 'doc-123',
        session_id: 'session-123',
        filename: 'test.txt',
        content_preview: 'This is a test document...',
        chunk_count: 2,
        created_at: new Date()
      }

      const mockChunks = [
        {
          id: 'chunk-1',
          document_id: 'doc-123',
          content: 'This is a test document with some content.',
          embedding: [0.1, 0.2, 0.3],
          chunk_index: 0,
          created_at: new Date()
        },
        {
          id: 'chunk-2',
          document_id: 'doc-123',
          content: 'This is the second chunk of content.',
          embedding: [0.4, 0.5, 0.6],
          chunk_index: 1,
          created_at: new Date()
        }
      ]

      const chunks = [
        { content: 'This is a test document with some content.', embedding: [0.1, 0.2, 0.3], index: 0 },
        { content: 'This is the second chunk of content.', embedding: [0.4, 0.5, 0.6], index: 1 }
      ]

      // Mock transaction queries
      pg.__mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [mockDocument] }) // INSERT document
        .mockResolvedValueOnce({ rows: [mockChunks[0]] }) // INSERT chunk 1
        .mockResolvedValueOnce({ rows: [mockChunks[1]] }) // INSERT chunk 2
        .mockResolvedValueOnce({ rows: [] }) // UPDATE session count
        .mockResolvedValueOnce({ rows: [] }) // COMMIT

      const result = await storeDocument('session-123', 'test.txt', chunks)

      expect(result.document).toEqual(mockDocument)
      expect(result.chunks).toHaveLength(2)
      expect(pg.__mockQuery).toHaveBeenCalledWith('BEGIN')
      expect(pg.__mockQuery).toHaveBeenCalledWith('COMMIT')
    })

    it('should rollback transaction on error', async () => {
      const chunks = [
        { content: 'Test content', embedding: [0.1, 0.2, 0.3], index: 0 }
      ]

      pg.__mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(new Error('Database error')) // INSERT document fails

      await expect(storeDocument('session-123', 'test.txt', chunks)).rejects.toThrow('Database error')
      
      expect(pg.__mockQuery).toHaveBeenCalledWith('ROLLBACK')
    })
  })

  describe('Vector Search', () => {
    it('should find relevant chunks using vector similarity', async () => {
      const mockResults: VectorSearchResult[] = [
        {
          content: 'Relevant content about vacation policy',
          filename: 'hr-policy.txt',
          similarity: 0.85,
          chunk_index: 0,
          document_id: 'doc-123'
        },
        {
          content: 'Another relevant piece of information',
          filename: 'hr-policy.txt',
          similarity: 0.78,
          chunk_index: 1,
          document_id: 'doc-123'
        }
      ]

      pg.__mockQuery.mockResolvedValue({ rows: mockResults })

      const queryEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5]
      const result = await findRelevantChunks({
        session_id: 'session-123',
        query_embedding: queryEmbedding,
        similarity_threshold: 0.7,
        max_results: 5
      })

      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('1 - (dc.embedding <=> $2::vector) AS similarity'),
        ['session-123', JSON.stringify(queryEmbedding), 0.7, 5]
      )
      expect(result).toEqual(mockResults)
    })

    it('should use default parameters for vector search', async () => {
      pg.__mockQuery.mockResolvedValue({ rows: [] })

      await findRelevantChunks({
        session_id: 'session-123',
        query_embedding: [0.1, 0.2, 0.3]
      })

      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        ['session-123', JSON.stringify([0.1, 0.2, 0.3]), 0.7, 5]
      )
    })
  })

  describe('Session Documents', () => {
    it('should get all documents for a session', async () => {
      const mockDocuments = [
        {
          id: 'doc-1',
          session_id: 'session-123',
          filename: 'file1.txt',
          content_preview: 'Preview 1...',
          chunk_count: 3,
          created_at: new Date()
        },
        {
          id: 'doc-2',
          session_id: 'session-123',
          filename: 'file2.txt',
          content_preview: 'Preview 2...',
          chunk_count: 2,
          created_at: new Date()
        }
      ]

      pg.__mockQuery.mockResolvedValue({ rows: mockDocuments })

      const result = await getSessionDocuments('session-123')

      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT id, session_id, filename'),
        ['session-123']
      )
      expect(result).toEqual(mockDocuments)
    })
  })

  describe('Cleanup Operations', () => {
    it('should cleanup old sessions', async () => {
      pg.__mockQuery.mockResolvedValue({ rowCount: 3 })

      const result = await cleanupOldSessions()

      expect(pg.__mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM demo_sessions")
      )
      expect(result).toBe(3)
    })

    it('should handle zero cleanup results', async () => {
      pg.__mockQuery.mockResolvedValue({ rowCount: 0 })

      const result = await cleanupOldSessions()

      expect(result).toBe(0)
    })

    it('should handle null rowCount', async () => {
      pg.__mockQuery.mockResolvedValue({ rowCount: null })

      const result = await cleanupOldSessions()

      expect(result).toBe(0)
    })
  })
}) 