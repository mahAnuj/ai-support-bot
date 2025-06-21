import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FileUpload from '@/components/ui/FileUpload'

// Mock file for testing
const createMockFile = (name: string, type: string, size: number = 1024) => {
  const file = new File(['mock content'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('FileUpload', () => {
  const mockOnUpload = jest.fn()
  const mockOnProgress = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should render drag-and-drop interface', () => {
    render(<FileUpload onUpload={mockOnUpload} onProgress={mockOnProgress} />)
    
    expect(screen.getByText(/add your knowledge/i)).toBeInTheDocument()
    expect(screen.getByText(/PDF, TXT, DOCX supported/i)).toBeInTheDocument()
    expect(screen.getByText(/click to upload/i)).toBeInTheDocument()
  })

  it('should handle file selection via input', async () => {
    render(<FileUpload onUpload={mockOnUpload} onProgress={mockOnProgress} />)
    
    const fileInput = screen.getByTestId('file-input')
    const mockFile = createMockFile('test.pdf', 'application/pdf')
    
    fireEvent.change(fileInput, { target: { files: [mockFile] } })
    
    await waitFor(() => {
      expect(mockOnUpload).toHaveBeenCalledWith([mockFile])
    })
  })

  it('should show processing state when uploading', async () => {
    render(<FileUpload onUpload={mockOnUpload} onProgress={mockOnProgress} isProcessing={true} />)
    
    expect(screen.getByText(/adding knowledge to ai/i)).toBeInTheDocument()
    expect(screen.getByTestId('progress-bar')).toBeInTheDocument()
  })

  it('should display upload progress', () => {
    render(<FileUpload onUpload={mockOnUpload} onProgress={mockOnProgress} isProcessing={true} progress={65} />)
    
    const progressBar = screen.getByTestId('progress-bar')
    expect(progressBar).toHaveStyle('width: 65%')
    expect(screen.getByText('65% complete')).toBeInTheDocument()
  })

  it('should validate file types', async () => {
    render(<FileUpload onUpload={mockOnUpload} onProgress={mockOnProgress} />)
    
    const fileInput = screen.getByTestId('file-input')
    const invalidFile = createMockFile('test.exe', 'application/exe')
    
    fireEvent.change(fileInput, { target: { files: [invalidFile] } })
    
    await waitFor(() => {
      expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument()
    })
    expect(mockOnUpload).not.toHaveBeenCalled()
  })

  it('should show success state after upload', () => {
    render(<FileUpload onUpload={mockOnUpload} onProgress={mockOnProgress} isComplete={true} />)
    
    expect(screen.getByText(/knowledge added to AI/i)).toBeInTheDocument()
    expect(screen.getByTestId('success-icon')).toBeInTheDocument()
  })

  it('should support drag and drop', async () => {
    render(<FileUpload onUpload={mockOnUpload} onProgress={mockOnProgress} />)
    
    const dropZone = screen.getByTestId('drop-zone')
    const mockFile = createMockFile('test.txt', 'text/plain')
    
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [mockFile]
      }
    })
    
    await waitFor(() => {
      expect(mockOnUpload).toHaveBeenCalledWith([mockFile])
    })
  })

  it('should show visual feedback during drag over', () => {
    render(<FileUpload onUpload={mockOnUpload} onProgress={mockOnProgress} />)
    
    const dropZone = screen.getByTestId('drop-zone')
    
    fireEvent.dragOver(dropZone)
    expect(dropZone).toHaveClass('border-blue-400')
    
    fireEvent.dragLeave(dropZone)
    expect(dropZone).not.toHaveClass('border-blue-400')
  })

  it('should handle multiple files', async () => {
    render(<FileUpload onUpload={mockOnUpload} onProgress={mockOnProgress} />)
    
    const fileInput = screen.getByTestId('file-input')
    const files = [
      createMockFile('doc1.pdf', 'application/pdf'),
      createMockFile('doc2.txt', 'text/plain')
    ]
    
    fireEvent.change(fileInput, { target: { files } })
    
    await waitFor(() => {
      expect(mockOnUpload).toHaveBeenCalledWith(files)
    })
  })
}) 