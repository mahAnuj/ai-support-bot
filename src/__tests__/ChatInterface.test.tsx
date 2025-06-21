import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import ChatInterface from '../components/ui/ChatInterface'

// Mock the FileUpload component
jest.mock('../components/ui/FileUpload', () => {
  return function MockFileUpload({ onUpload, isProcessing, isComplete }: any) {
    return (
      <div data-testid="file-upload">
        <button 
          onClick={() => onUpload([new File(['test'], 'test.txt', { type: 'text/plain' })])}
          disabled={isProcessing}
        >
          {isProcessing ? 'Processing...' : isComplete ? 'Complete' : 'Upload Files'}
        </button>
      </div>
    )
  }
})

// Mock fetch globally
global.fetch = jest.fn()

const mockFetch = fetch as jest.MockedFunction<typeof fetch>

describe('ChatInterface', () => {
  beforeEach(() => {
    mockFetch.mockClear()
  })

  it('renders the main interface with upload section always visible', () => {
    render(<ChatInterface />)
    
    expect(screen.getByText('RAG Knowledge Playground')).toBeInTheDocument()
    expect(screen.getByText('📚 Upload Documents to Improve Responses')).toBeInTheDocument()
    expect(screen.getByText('Try asking me anything!')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ask me anything...')).toBeInTheDocument()
    expect(screen.getByTestId('file-upload')).toBeInTheDocument()
  })

  it('shows example prompts when no messages', () => {
    render(<ChatInterface />)
    
    expect(screen.getByText('💡 Example: "What\'s our company vacation policy?"')).toBeInTheDocument()
    expect(screen.getByText('💡 Example: "How do I reset the device?"')).toBeInTheDocument()
    expect(screen.getByText('💡 Example: "What were the key meeting decisions?"')).toBeInTheDocument()
  })

  it('sends a message and displays response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: 'This is a test response',
        confidence: 75,
        sources: [],
        isEnhanced: false,
        sessionId: 'test-session-123'
      })
    } as Response)

    render(<ChatInterface />)
    
    const input = screen.getByPlaceholderText('Ask me anything...')
    const sendButton = screen.getByText('Send')
    
    fireEvent.change(input, { target: { value: 'Test question' } })
    fireEvent.click(sendButton)
    
    // Check that user message appears
    expect(screen.getByText('Test question')).toBeInTheDocument()
    
    // Wait for AI response
    await waitFor(() => {
      expect(screen.getByText('This is a test response')).toBeInTheDocument()
    })

    // Check that confidence is displayed
    expect(screen.getByText('75% confidence')).toBeInTheDocument()

    // Check that session ID is displayed
    expect(screen.getByText('Session: test-ses...')).toBeInTheDocument()
  })

  it('shows enhanced response styling for high-confidence responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: 'Enhanced response with knowledge',
        confidence: 95,
        sources: ['document1.pdf'],
        isEnhanced: true,
        sessionId: 'test-session-123'
      })
    } as Response)

    render(<ChatInterface />)
    
    const input = screen.getByPlaceholderText('Ask me anything...')
    fireEvent.change(input, { target: { value: 'Test question' } })
    fireEvent.click(screen.getByText('Send'))
    
    await waitFor(() => {
      expect(screen.getByText('Enhanced response with knowledge')).toBeInTheDocument()
    })

    // Check enhanced styling indicators
    expect(screen.getByText('✨ Enhanced')).toBeInTheDocument()
    expect(screen.getByText('📄 Sources: document1.pdf')).toBeInTheDocument()
    expect(screen.getByTestId('enhanced-message')).toBeInTheDocument()
  })

  it('handles file upload successfully', async () => {
    // Mock upload API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        documentsProcessed: 1,
        totalChunks: 5,
        sessionId: 'test-session-123'
      })
    } as Response)

    render(<ChatInterface />)
    
    const uploadButton = screen.getByText('Upload Files')
    fireEvent.click(uploadButton)
    
    await waitFor(() => {
      expect(screen.getByText(/Successfully processed 1 document/)).toBeInTheDocument()
    })

    // Check that upload status is updated
    expect(screen.getByText(/Documents loaded - responses are now enhanced!/)).toBeInTheDocument()
  })

  it('handles API errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('API Error'))

    render(<ChatInterface />)
    
    const input = screen.getByPlaceholderText('Ask me anything...')
    fireEvent.change(input, { target: { value: 'Test question' } })
    fireEvent.click(screen.getByText('Send'))
    
    await waitFor(() => {
      expect(screen.getByText('Sorry, I encountered an error. Please try again.')).toBeInTheDocument()
    })
  })

  it('handles upload errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Upload failed'))

    render(<ChatInterface />)
    
    const uploadButton = screen.getByText('Upload Files')
    fireEvent.click(uploadButton)
    
    await waitFor(() => {
      expect(screen.getByText('❌ Failed to upload documents. Please try again.')).toBeInTheDocument()
    })
  })

  it('sends message on Enter key press', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: 'Response to Enter key',
        confidence: 60,
        sources: [],
        isEnhanced: false,
        sessionId: 'test-session-123'
      })
    } as Response)

    render(<ChatInterface />)
    
    const input = screen.getByPlaceholderText('Ask me anything...')
    fireEvent.change(input, { target: { value: 'Enter key test' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false })
    
    await waitFor(() => {
      expect(screen.getByText('Response to Enter key')).toBeInTheDocument()
    })
  })

  it('does not send message on Shift+Enter', () => {
    render(<ChatInterface />)
    
    const input = screen.getByPlaceholderText('Ask me anything...')
    fireEvent.change(input, { target: { value: 'Shift+Enter test' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    
    // Message should not be sent, so it should still be in the input
    expect(input).toHaveValue('Shift+Enter test')
    expect(screen.queryByText('Shift+Enter test')).not.toBeInTheDocument()
  })

  it('disables input and button while typing', async () => {
    // Mock a delayed response
    let resolveResponse: (value: any) => void
    const responsePromise = new Promise(resolve => {
      resolveResponse = resolve
    })
    
    mockFetch.mockReturnValueOnce(responsePromise as any)

    render(<ChatInterface />)
    
    const input = screen.getByPlaceholderText('Ask me anything...')
    const sendButton = screen.getByText('Send')
    
    fireEvent.change(input, { target: { value: 'Test message' } })
    fireEvent.click(sendButton)
    
    // Check that input and button are disabled
    expect(input).toBeDisabled()
    expect(sendButton).toBeDisabled()
    expect(sendButton).toHaveTextContent('Sending...')
    
    // Show typing indicator
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
    
    // Resolve the response
    resolveResponse!({
      ok: true,
      json: async () => ({
        message: 'Delayed response',
        confidence: 80,
        sources: [],
        isEnhanced: false,
        sessionId: 'test-session-123'
      })
    })
    
    await waitFor(() => {
      expect(input).not.toBeDisabled()
      expect(sendButton).toHaveTextContent('Send')
    })
    
    // Add some text to input to enable the send button
    fireEvent.change(input, { target: { value: 'New message' } })
    
    await waitFor(() => {
      expect(sendButton).not.toBeDisabled()
    })
  })

  it('shows different confidence styling based on score', async () => {
    // Test low confidence
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: 'Low confidence response',
        confidence: 30,
        sources: [],
        isEnhanced: false,
        sessionId: 'test-session-123'
      })
    } as Response)

    render(<ChatInterface />)
    
    const input = screen.getByPlaceholderText('Ask me anything...')
    fireEvent.change(input, { target: { value: 'Test low confidence' } })
    fireEvent.click(screen.getByText('Send'))
    
    await waitFor(() => {
      const confidenceElement = screen.getByText('30% confidence')
      expect(confidenceElement).toHaveClass('bg-red-100', 'text-red-700')
    })
  })
}) 