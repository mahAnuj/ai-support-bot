'use client'

import React, { useId, useRef, useState } from 'react'
import { FileUploadProps } from '@/types'

const ACCEPT = '.pdf,.docx,.txt,.md'
const ACCEPTED_EXTENSION = /\.(pdf|docx|txt|md)$/i
const MB = 1024 * 1024

function formatMb(bytes: number): string {
  const mb = bytes / MB
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(1)
}

export default function FileUpload({
  onUpload,
  isProcessing = false,
  isComplete = false,
  maxFiles = 5,
  maxSize = 10 * MB
}: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const helpId = useId()
  const errorId = useId()

  const limitMb = formatMb(maxSize)

  const validate = (files: File[]): string[] => {
    if (files.length > maxFiles) {
      return [`Choose up to ${maxFiles} files at a time. You selected ${files.length}.`]
    }
    const found: string[] = []
    for (const file of files) {
      if (!ACCEPTED_EXTENSION.test(file.name)) {
        found.push(`"${file.name}" isn't a supported file type. Use PDF, DOCX, TXT or MD.`)
      } else if (file.size > maxSize) {
        found.push(`"${file.name}" is ${(file.size / MB).toFixed(1)} MB. The limit is ${limitMb} MB per file.`)
      }
    }
    return found
  }

  const handleFiles = (list: FileList | null) => {
    if (!list || isProcessing) return
    const files = Array.from(list)
    if (files.length === 0) return
    const found = validate(files)
    setErrors(found)
    if (found.length === 0) {
      onUpload(files)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(e.target.files)
    e.target.value = ''
  }

  const handleDragOver = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    if (!isProcessing) setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    handleFiles(e.dataTransfer?.files ?? null)
  }

  const zoneState = isDragOver
    ? 'border-solid border-accent bg-accent-tint'
    : 'border-dashed border-line-strong bg-surface hover:bg-sunken'

  return (
    <div className="w-full">
      {isComplete && !isProcessing && (
        <p className="mb-3 flex items-center gap-2 text-sm text-ink-muted">
          <svg
            aria-hidden="true"
            className="size-4 shrink-0 text-accent"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Indexed. You can add more files to this session.
        </p>
      )}

      <input
        ref={fileInputRef}
        data-testid="file-input"
        type="file"
        multiple
        accept={ACCEPT}
        onChange={handleInputChange}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />

      <button
        type="button"
        data-testid="drop-zone"
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={isProcessing}
        aria-busy={isProcessing}
        aria-describedby={errors.length > 0 ? errorId : undefined}
        className={`flex w-full flex-col items-center gap-2 rounded-md border-2 px-4 py-8 text-center transition-colors duration-150 disabled:cursor-not-allowed disabled:hover:bg-surface ${zoneState}`}
      >
        {isProcessing ? (
          <>
            <span
              aria-hidden="true"
              className="size-6 animate-spin rounded-full border-2 border-accent border-t-transparent"
            />
            <span className="text-sm text-ink">Uploading and indexing…</span>
          </>
        ) : (
          <>
            <svg
              aria-hidden="true"
              className="size-6 text-accent"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 15V3" />
              <path d="m7 8 5-5 5 5" />
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            </svg>
            <span className="text-base font-semibold text-ink">
              {isDragOver ? 'Drop to upload' : 'Choose files or drop them here'}
            </span>
            <span id={helpId} className="text-sm text-ink-muted">
              {`PDF, DOCX, TXT or MD. Up to ${maxFiles} files, ${limitMb} MB each.`}
            </span>
          </>
        )}
      </button>

      <p role="status" aria-live="polite" className="sr-only">
        {isProcessing ? 'Uploading and indexing files.' : ''}
      </p>

      {errors.length > 0 && (
        <div
          id={errorId}
          role="alert"
          className="mt-3 rounded-md border border-danger/40 bg-danger-tint px-3 py-2.5 text-sm text-ink"
        >
          <p className="flex items-center gap-2 font-semibold text-danger">
            <svg
              aria-hidden="true"
              className="size-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
            Nothing was uploaded.
          </p>
          <ul className="mt-1 space-y-1">
            {errors.map((message, i) => (
              <li key={`${i}-${message}`}>{message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
