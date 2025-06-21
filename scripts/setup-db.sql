-- Setup script for AI Support Bot RAG database
-- Run this script to create the database and tables

-- Create database (run this as postgres superuser)
-- CREATE DATABASE ai_support_bot;

-- Connect to the database and run the following:

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create demo_sessions table
CREATE TABLE IF NOT EXISTS demo_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP DEFAULT NOW(),
  last_accessed TIMESTAMP DEFAULT NOW(),
  document_count INTEGER DEFAULT 0
);

-- Create session_documents table
CREATE TABLE IF NOT EXISTS session_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES demo_sessions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_preview TEXT,
  chunk_count INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create document_chunks table with vector column
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES session_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding VECTOR(1536), -- OpenAI embedding dimension
  chunk_index INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx 
ON document_chunks USING ivfflat (embedding vector_cosine_ops);

-- Create index for session cleanup
CREATE INDEX IF NOT EXISTS demo_sessions_created_at_idx 
ON demo_sessions (created_at);

-- Create index for document lookup
CREATE INDEX IF NOT EXISTS session_documents_session_id_idx 
ON session_documents (session_id);

-- Create index for chunk lookup
CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx 
ON document_chunks (document_id); 