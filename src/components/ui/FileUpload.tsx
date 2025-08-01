'use client'

import React, { useState, useRef } from 'react'
import { FileUploadProps } from '@/types'

const SUPPORTED_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword'
]

export default function FileUpload({ 
  onUpload, 
  onProgress, 
  isProcessing = false, 
  isComplete = false, 
  progress = 0,
  compact = false
}: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const validateFiles = (files: FileList | File[]): File[] => {
    const fileArray = Array.from(files)
    const validFiles: File[] = []

    for (const file of fileArray) {
      // Check both MIME type and file extension (fallback for when MIME type is not set correctly)
      const isValidMimeType = SUPPORTED_TYPES.includes(file.type)
      const isValidExtension = file.name.match(/\.(txt|md|pdf|docx|doc)$/i)
      
      if (!isValidMimeType && !isValidExtension) {
        setError(`Unsupported file type: ${file.name}. Please upload PDF, TXT, MD, or DOCX files.`)
        return []
      }
      validFiles.push(file)
    }

    setError(null)
    return validFiles
  }

  const handleFileSelect = (files: FileList | File[]) => {
    const validFiles = validateFiles(files)
    if (validFiles.length > 0) {
      onUpload(validFiles)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFileSelect(e.target.files)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    
    if (e.dataTransfer?.files) {
      handleFileSelect(e.dataTransfer.files)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  if (isComplete) {
    if (compact) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-100 rounded-lg animate-pulse">
          <div className="text-green-600 text-sm">✅</div>
          <div className="text-xs text-green-700 font-medium">
            Uploaded!
          </div>
        </div>
      )
    }
    
    return (
      <div className="text-center p-8 bg-gradient-to-br from-green-50 to-emerald-100 border border-green-200 rounded-lg shadow-lg transform transition-all duration-500 hover:scale-105">
        <div data-testid="success-icon" className="text-6xl mb-4 animate-bounce">✨</div>
        <h3 className="text-2xl font-bold text-green-800 mb-3">
          🎉 Knowledge Added to AI!
        </h3>
        <p className="text-green-700 mb-4 text-lg">
          Your documents have been processed and your AI is now a domain expert!
        </p>
        <div className="bg-green-100 border border-green-300 rounded-lg p-4 mx-auto max-w-md">
          <p className="text-green-800 text-sm font-medium">
            🚀 Ready for enhanced responses with your knowledge
          </p>
        </div>
      </div>
    )
  }

  if (isProcessing) {
    if (compact) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-100 rounded-lg">
          <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
          <div className="text-xs text-blue-700">
            Processing... {progress}%
          </div>
        </div>
      )
    }
    
    return (
      <div className="text-center p-8 bg-gradient-to-br from-blue-50 to-indigo-100 border border-blue-200 rounded-lg shadow-lg">
        <div className="flex justify-center items-center mb-6">
          <div className="text-4xl animate-spin mr-3">⚡</div>
          <div className="text-3xl animate-pulse">🧠</div>
          <div className="text-4xl animate-spin ml-3">✨</div>
        </div>
        <h3 className="text-xl font-bold text-blue-800 mb-2">
          🔮 Adding Knowledge to AI...
        </h3>
        <p className="text-blue-600 mb-6 text-sm">
          Transforming your documents into AI-ready knowledge
        </p>
        
        <div className="w-full bg-blue-200 rounded-full h-4 mb-3 shadow-inner">
          <div 
            data-testid="progress-bar"
            className="bg-gradient-to-r from-blue-500 to-purple-600 h-4 rounded-full transition-all duration-500 shadow-lg"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-blue-700 font-medium">
          {progress}% complete
        </p>
        
        <div className="mt-4 text-xs text-blue-500">
          {progress < 30 && "📄 Reading documents..."}
          {progress >= 30 && progress < 60 && "🔤 Extracting text..."}
          {progress >= 60 && progress < 90 && "🧮 Generating embeddings..."}
          {progress >= 90 && "💾 Storing knowledge..."}
        </div>
      </div>
    )
  }

  // Compact mode for header
  if (compact) {
    return (
      <div className="relative">
        <input
          ref={fileInputRef}
          data-testid="file-input"
          type="file"
          multiple
          accept=".pdf,.txt,.md,.docx,.doc"
          onChange={handleInputChange}
          className="hidden"
        />
        
        <button
          onClick={handleClick}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
            isDragOver
              ? 'bg-blue-600 text-white shadow-lg'
              : 'bg-blue-500 text-white hover:bg-blue-600 shadow-md hover:shadow-lg'
          }`}
        >
          📎 Upload Files
        </button>
        
        {error && (
          <div className="absolute top-full left-0 mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 whitespace-nowrap z-10">
            {error}
          </div>
        )}
      </div>
    )
  }

  // Full mode for main interface
  return (
    <div className="w-full">
      <div
        data-testid="drop-zone"
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-300 transform hover:scale-105 ${
          isDragOver 
            ? 'border-blue-400 bg-gradient-to-br from-blue-50 to-indigo-100 shadow-lg scale-105' 
            : 'border-gray-300 bg-gradient-to-br from-gray-50 to-blue-50 hover:bg-gradient-to-br hover:from-blue-50 hover:to-indigo-50 hover:shadow-md'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          data-testid="file-input"
          type="file"
          multiple
          accept=".pdf,.txt,.md,.docx,.doc"
          onChange={handleInputChange}
          className="hidden"
        />
        
        <div className={`text-4xl mb-3 ${isDragOver ? 'animate-bounce' : 'animate-pulse'}`}>
          {isDragOver ? '🎯' : '📚'}
        </div>
        
        <h3 className="text-xl font-bold text-gray-800 mb-2">
          {isDragOver ? '🎉 Drop to Transform AI!' : '✨ Add Your Knowledge'}
        </h3>
        
        <p className="text-gray-600 mb-4 text-base">
          {isDragOver ? 'Release to make AI smarter!' : 'PDF, TXT, DOCX supported (up to 10MB)'}
        </p>
        
        <button className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-6 py-2 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold">
          📎 Click to Upload
        </button>
        
        <div className="mt-4 flex justify-center items-center space-x-4 text-sm text-gray-500">
          <div className="flex items-center">
            <span className="text-amber-500 mr-1">⚡</span>
            <span>Your Knowledge</span>
          </div>
          <div>=</div>
          <div className="flex items-center">
            <span className="text-green-500 mr-1">🚀</span>
            <span>Better AI</span>
          </div>
        </div>
        
        <div className="mt-2 text-xs text-gray-400">
          Transform generic AI into YOUR domain expert
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}
    </div>
  )
} 