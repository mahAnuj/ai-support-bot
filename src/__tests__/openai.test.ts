import { generateResponse } from '@/lib/openai'

// Mock OpenAI
jest.mock('openai', () => {
  const mockCreate = jest.fn()
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate
        }
      }
    }))
  }
})

describe('OpenAI Integration', () => {
  let mockCreate: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    // Get the mock from the mocked OpenAI constructor
    const OpenAI = require('openai').default
    const mockInstance = new OpenAI()
    mockCreate = mockInstance.chat.completions.create
  })

  describe('generateResponse', () => {
    it('should generate generic response without context', async () => {
      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            content: "I don't have specific information about that topic."
          }
        }]
      })

      const result = await generateResponse({
        query: "What's our vacation policy?",
        isEnhanced: false
      })

      expect(result.message).toContain("don't have specific information")
      expect(result.confidence).toBe(30)
      expect(result.sources).toBeUndefined()
    })

    it('should generate enhanced response with context', async () => {
      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            content: "Based on your HR policy, employees get 15 days of vacation per year."
          }
        }]
      })

      const result = await generateResponse({
        query: "What's our vacation policy?",
        context: "HR Policy: Employees receive 15 vacation days annually.",
        isEnhanced: true
      })

      expect(result.message).toContain("15 days")
      expect(result.confidence).toBe(95)
      expect(result.sources).toEqual(['Uploaded Documents'])
    })

    it('should handle API errors gracefully', async () => {
      mockCreate.mockRejectedValue(new Error('API Error'))

      const result = await generateResponse({
        query: "Test question",
        isEnhanced: false
      })

      expect(result.message).toContain("I'm having trouble")
      expect(result.confidence).toBe(10)
    })

    it('should truncate context if too long', async () => {
      const longContext = 'A'.repeat(5000) // Very long context
      
      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            content: "Response based on context"
          }
        }]
      })

      await generateResponse({
        query: "Test question",
        context: longContext,
        isEnhanced: true
      })

      // Check that the system prompt was created (context was processed)
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining('Context from uploaded documents')
            })
          ])
        })
      )
    })
  })
}) 