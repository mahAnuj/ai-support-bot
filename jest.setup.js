import '@testing-library/jest-dom'
import { TextEncoder, TextDecoder } from 'util'

// Add TextEncoder/TextDecoder polyfills for Node.js
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

// Mock environment variables
process.env.OPENAI_API_KEY = 'test-api-key'

// Mock OpenAI module
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn()
        }
      },
      embeddings: {
        create: jest.fn()
      }
    }))
  }
})

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

// Mock scrollIntoView for JSDOM
Object.defineProperty(Element.prototype, 'scrollIntoView', {
  value: jest.fn(),
  writable: true,
})

// Mock fetch for API calls
global.fetch = jest.fn()

// Mock FileReader for file processing tests
global.FileReader = class MockFileReader {
  constructor() {
    this.onload = null
    this.onerror = null
    this.result = null
  }
  
  readAsText(file) {
    // Simulate async file reading
    setTimeout(() => {
      if (file && file.constructor.name === 'File') {
        // Extract content from File constructor
        try {
          // For mock files created with new File([content], name)
          const content = file.stream ? 'Mock file content' : 'Default content'
          this.result = content
          if (this.onload) {
            this.onload({ target: { result: content } })
          }
        } catch (error) {
          if (this.onerror) {
            this.onerror(error)
          }
        }
      } else {
        if (this.onerror) {
          this.onerror(new Error('Invalid file'))
        }
      }
    }, 0)
  }
}

// Mock File.text() method for tests
const originalFile = global.File
if (originalFile) {
  global.File = class extends originalFile {
    constructor(...args) {
      super(...args)
    }
    
    text() {
      // Return the content that was passed to the File constructor
      return Promise.resolve('Mock file content')
    }
  }
}

// Reset fetch mock before each test
beforeEach(() => {
  global.fetch.mockClear()
}) 