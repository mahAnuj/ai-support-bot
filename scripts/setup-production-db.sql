-- Production Multi-Tenant RAG Database Schema
-- For AI Support Bot Embeddable Widgets
-- Supports multiple businesses with isolated knowledge bases

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =======================
-- BUSINESS/TENANT TABLES
-- =======================

-- Businesses/Organizations table
CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  api_key UUID UNIQUE DEFAULT uuid_generate_v4(),
  plan_type TEXT DEFAULT 'free' CHECK (plan_type IN ('free', 'pro', 'enterprise')),
  max_documents INTEGER DEFAULT 10,
  max_storage_mb INTEGER DEFAULT 100,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

-- Business usage tracking
CREATE TABLE IF NOT EXISTS business_usage (
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  documents_count INTEGER DEFAULT 0,
  storage_used_mb INTEGER DEFAULT 0,
  queries_this_month INTEGER DEFAULT 0,
  last_reset_date DATE DEFAULT CURRENT_DATE,
  PRIMARY KEY (business_id)
);

-- =======================
-- KNOWLEDGE BASE TABLES
-- =======================

-- Knowledge bases (businesses can have multiple)
CREATE TABLE IF NOT EXISTS knowledge_bases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT,
  role_context TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Composite unique constraint
  UNIQUE(business_id, name)
);

-- Documents within knowledge bases
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  knowledge_base_id UUID REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_preview TEXT,
  file_size_bytes INTEGER,
  mime_type TEXT,
  chunk_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Document chunks with embeddings
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  knowledge_base_id UUID REFERENCES knowledge_bases(id) ON DELETE CASCADE, -- Denormalized for faster queries
  content TEXT NOT NULL,
  embedding VECTOR(1536), -- OpenAI embedding dimension
  chunk_index INTEGER,
  token_count INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- =======================
-- WIDGET CONFIGURATION
-- =======================

-- Embeddable widgets
CREATE TABLE IF NOT EXISTS widgets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  knowledge_base_id UUID REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  widget_key UUID UNIQUE DEFAULT uuid_generate_v4(), -- Public key for embedding
  name TEXT NOT NULL,
  title TEXT DEFAULT 'AI Support Assistant',
  welcome_message TEXT DEFAULT 'Hi! How can I help you today?',
  primary_color TEXT DEFAULT '#3B82F6',
  position TEXT DEFAULT 'bottom-right' CHECK (position IN ('bottom-right', 'bottom-left')),
  size TEXT DEFAULT 'medium' CHECK (size IN ('small', 'medium', 'large')),
  allowed_domains TEXT[], -- Array of allowed domains for CORS
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Composite unique constraint
  UNIQUE(business_id, name)
);

-- =======================
-- ANALYTICS & LOGGING
-- =======================

-- Widget usage analytics
CREATE TABLE IF NOT EXISTS widget_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  widget_id UUID REFERENCES widgets(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  user_ip INET,
  user_agent TEXT,
  domain TEXT,
  messages_count INTEGER DEFAULT 0,
  started_at TIMESTAMP DEFAULT NOW(),
  last_message_at TIMESTAMP DEFAULT NOW()
);

-- Individual messages for analytics
CREATE TABLE IF NOT EXISTS widget_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES widget_conversations(id) ON DELETE CASCADE,
  message_type TEXT CHECK (message_type IN ('user', 'assistant')),
  content TEXT,
  confidence_score INTEGER,
  sources_used TEXT[],
  response_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- =======================
-- SEARCH FUNCTIONS
-- =======================

-- Optimized vector similarity search function
CREATE OR REPLACE FUNCTION find_relevant_chunks_for_knowledge_base(
  kb_id UUID,
  query_embedding VECTOR(1536),
  similarity_threshold FLOAT DEFAULT 0.7,
  max_results INTEGER DEFAULT 5
) RETURNS TABLE (
  chunk_id UUID,
  content TEXT,
  filename TEXT,
  similarity FLOAT,
  chunk_index INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dc.id as chunk_id,
    dc.content,
    kd.filename,
    1 - (dc.embedding <=> query_embedding) AS similarity,
    dc.chunk_index
  FROM document_chunks dc
  JOIN knowledge_documents kd ON dc.document_id = kd.id
  WHERE dc.knowledge_base_id = kb_id
    AND kd.status = 'completed'
    AND 1 - (dc.embedding <=> query_embedding) > similarity_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- =======================
-- INDEXES FOR PERFORMANCE
-- =======================

-- Vector similarity search indexes
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx 
ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Business and knowledge base indexes
CREATE INDEX IF NOT EXISTS businesses_api_key_idx ON businesses (api_key);
CREATE INDEX IF NOT EXISTS knowledge_bases_business_id_idx ON knowledge_bases (business_id);
CREATE INDEX IF NOT EXISTS knowledge_documents_kb_id_idx ON knowledge_documents (knowledge_base_id);
CREATE INDEX IF NOT EXISTS document_chunks_kb_id_idx ON document_chunks (knowledge_base_id);

-- Widget indexes
CREATE INDEX IF NOT EXISTS widgets_widget_key_idx ON widgets (widget_key);
CREATE INDEX IF NOT EXISTS widgets_business_id_idx ON widgets (business_id);
CREATE INDEX IF NOT EXISTS widgets_kb_id_idx ON widgets (knowledge_base_id);

-- Analytics indexes
CREATE INDEX IF NOT EXISTS widget_conversations_widget_id_idx ON widget_conversations (widget_id);
CREATE INDEX IF NOT EXISTS widget_conversations_started_at_idx ON widget_conversations (started_at);
CREATE INDEX IF NOT EXISTS widget_messages_conversation_id_idx ON widget_messages (conversation_id);

-- =======================
-- UTILITY FUNCTIONS
-- =======================

-- Function to update business usage stats
CREATE OR REPLACE FUNCTION update_business_usage_stats(bus_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO business_usage (business_id, documents_count, storage_used_mb)
  VALUES (
    bus_id,
    (SELECT COUNT(*) FROM knowledge_documents kd 
     JOIN knowledge_bases kb ON kd.knowledge_base_id = kb.id 
     WHERE kb.business_id = bus_id AND kd.status = 'completed'),
    (SELECT COALESCE(SUM(file_size_bytes), 0) / 1024 / 1024 FROM knowledge_documents kd
     JOIN knowledge_bases kb ON kd.knowledge_base_id = kb.id 
     WHERE kb.business_id = bus_id)::INTEGER
  )
  ON CONFLICT (business_id) 
  DO UPDATE SET 
    documents_count = EXCLUDED.documents_count,
    storage_used_mb = EXCLUDED.storage_used_mb;
END;
$$ LANGUAGE plpgsql;

-- =======================
-- SAMPLE DATA (OPTIONAL)
-- =======================

-- Create a sample business for testing
INSERT INTO businesses (name, email, plan_type) 
VALUES ('Acme Corp', 'admin@acme.com', 'pro')
ON CONFLICT (email) DO NOTHING;

-- Grant appropriate permissions (adjust as needed)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_app_user; 