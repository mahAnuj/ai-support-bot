// FileUpload component types (still used for standalone file upload)
export interface FileUploadProps {
  onUpload: (files: File[]) => void
  onProgress?: (progress: number) => void
  isProcessing?: boolean
  isComplete?: boolean
  progress?: number
  maxFiles?: number
  maxSize?: number // in bytes
  compact?: boolean // For compact mode in header
}

export interface UploadedFile {
  file: File
  id: string
  status: 'uploading' | 'processing' | 'complete' | 'error'
  progress: number
  error?: string
}

// ChatInterface component types (main component)
export interface ChatMessage {
  id: string
  text: string
  sender: 'user' | 'ai' | 'system'
  timestamp: Date
  isTyping?: boolean
  isEnhanced?: boolean // True if this is an AI response using uploaded knowledge
  confidence?: number // Confidence score for AI responses
  sources?: string[] // Source files used for enhanced responses
}

export interface ChatInterfaceProps {
  onShareResult?: (messageId: string) => void // Called when user wants to share a result
  systemPrompt?: string // Custom system prompt for role-based behavior
  roleContext?: string // Current role context for enhanced responses
  suggestedQuestions?: string[] // Questions that can be clicked to auto-send
  onSessionUpdate?: (sessionId: string | null, hasFiles: boolean) => void // Called when session state changes
  onGenerateWidget?: () => void // Called when user wants to generate widget code
  hasUploadedFiles?: boolean // Whether files have been uploaded (controlled by parent)
  sessionId?: string | null // Session ID from parent (controlled by parent)
  title?: string // Display title for the AI assistant
  welcomeMessage?: string // Welcome message shown to users
} 