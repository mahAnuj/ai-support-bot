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
          <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-xs text-green-700 font-medium">
            Uploaded!
          </div>
        </div>
      )
    }

    return (
      <div className="text-center p-8 bg-gradient-to-br from-green-50 to-emerald-100 border border-green-200 rounded-lg shadow-lg transform transition-all duration-500 hover:scale-105">
        <div data-testid="success-icon" className="flex justify-center mb-4">
          <svg className="w-16 h-16 text-green-600 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-2xl font-bold text-green-800 mb-3">
          Knowledge Added to AI!
        </h3>
        <p className="text-green-700 mb-4 text-lg">
          Your documents have been processed and your AI is now a domain expert!
        </p>
        <div className="bg-green-100 border border-green-300 rounded-lg p-4 mx-auto max-w-md">
          <p className="text-green-800 text-sm font-medium flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Ready for enhanced responses with your knowledge
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
          <svg className="w-10 h-10 text-blue-600 animate-spin mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <svg className="w-8 h-8 text-purple-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <svg className="w-10 h-10 text-green-600 animate-spin ml-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-blue-800 mb-2">
          Adding Knowledge to AI...
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

        <div className="mt-4 text-sm text-blue-500 flex items-center justify-center gap-2">
          {progress < 30 && (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Reading documents...
            </>
          )}
          {progress >= 30 && progress < 60 && (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Extracting text...
            </>
          )}
          {progress >= 60 && progress < 90 && (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Generating embeddings...
            </>
          )}
          {progress >= 90 && (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
              Storing knowledge...
            </>
          )}
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
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
            isDragOver
              ? 'bg-blue-600 text-white shadow-lg'
              : 'bg-blue-500 text-white hover:bg-blue-600 shadow-md hover:shadow-lg'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          Upload Files
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

        <div className={`mb-3 flex justify-center ${isDragOver ? 'animate-bounce' : 'animate-pulse'}`}>
          {isDragOver ? (
            <svg className="w-16 h-16 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-16 h-16 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          )}
        </div>

        <h3 className="text-xl font-bold text-gray-800 mb-2">
          {isDragOver ? 'Drop to Transform AI!' : 'Add Your Knowledge'}
        </h3>

        <p className="text-gray-600 mb-4 text-base">
          {isDragOver ? 'Release to make AI smarter!' : 'PDF, TXT, DOCX supported (up to 10MB)'}
        </p>

        <button className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-6 py-2 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold flex items-center gap-2 mx-auto">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          Click to Upload
        </button>

        <div className="mt-4 flex justify-center items-center space-x-4 text-sm text-gray-500">
          <div className="flex items-center">
            <svg className="w-4 h-4 text-amber-500 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span>Your Knowledge</span>
          </div>
          <div>=</div>
          <div className="flex items-center">
            <svg className="w-4 h-4 text-green-500 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
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