'use client'

import React, { useId, useRef, useState } from 'react'
import { FileUploadProps } from '@/types'

const ACCEPT = '.pdf,.docx,.txt,.md'
const ACCEPTED_EXTENSION = /\.(pdf|docx|txt|md)$/i
const MB = 1024 * 1024

type ZoneState = 'idle' | 'dragover' | 'uploading' | 'success' | 'error'

const iconProps = {
  'aria-hidden': true,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    </svg>
  )
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps} strokeWidth={2.25} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

const zoneClasses: Record<ZoneState, string> = {
  idle: 'border-dashed border-line-strong bg-surface hover:bg-sunken',
  dragover: 'border-solid border-accent bg-accent-tint',
  uploading: 'border-solid border-line bg-sunken',
  success: 'border-solid border-accent bg-surface hover:bg-sunken',
  error: 'border-solid border-danger bg-surface hover:bg-sunken',
}

function formatMb(bytes: number): string {
  const mb = bytes / MB
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(1)
}

export default function FileUpload({
  onUpload,
  isProcessing = false,
  isComplete = false,
  maxFiles = 5,
  maxSize = 10 * MB,
  serverError = null
}: FileUploadProps & { serverError?: string | null }) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const helpId = useId()
  const errorId = useId()
  const serverErrorId = useId()

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

  const state: ZoneState = isDragOver
    ? 'dragover'
    : isProcessing
      ? 'uploading'
      : serverError || errors.length > 0
        ? 'error'
        : isComplete
          ? 'success'
          : 'idle'

  const describedBy = [errors.length > 0 ? errorId : null, serverError ? serverErrorId : null]
    .filter(Boolean)
    .join(' ') || undefined

  return (
    <div className="w-full">
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
        data-state={state}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={isProcessing}
        aria-busy={isProcessing}
        aria-describedby={describedBy}
        className={`flex w-full flex-col items-center gap-2 rounded-md border-2 px-4 py-8 text-center disabled:cursor-not-allowed ${zoneClasses[state]}`}
      >
        {state === 'uploading' && (
          <>
            <span
              aria-hidden="true"
              className="size-6 rounded-full border-2 border-accent border-t-transparent motion-safe:animate-spin"
            />
            <span className="text-sm text-ink">Uploading and indexing…</span>
          </>
        )}

        {state === 'dragover' && (
          <>
            <span className="flex size-10 items-center justify-center rounded-full bg-surface text-accent">
              <UploadIcon className="size-5 motion-safe:-translate-y-0.5" />
            </span>
            <span className="text-base font-semibold text-ink">Drop to upload</span>
            <span id={helpId} className="text-sm text-ink-muted">
              {`PDF, DOCX, TXT or MD. Up to ${maxFiles} files, ${limitMb} MB each.`}
            </span>
          </>
        )}

        {state === 'idle' && (
          <>
            <span className="flex size-10 items-center justify-center rounded-full bg-accent-tint text-accent">
              <UploadIcon className="size-5" />
            </span>
            <span className="text-base font-semibold text-ink">Choose files or drop them here</span>
            <span id={helpId} className="text-sm text-ink-muted">
              {`PDF, DOCX, TXT or MD. Up to ${maxFiles} files, ${limitMb} MB each.`}
            </span>
          </>
        )}

        {state === 'success' && (
          <>
            <span className="flex size-10 items-center justify-center rounded-full bg-accent text-white">
              <CheckIcon className="size-5" />
            </span>
            <span className="text-base font-semibold text-ink">Indexed. You can add more files to this session.</span>
            <span className="text-sm text-ink-muted">Choose more files or drop them here</span>
            <span id={helpId} className="text-sm text-ink-muted">
              {`PDF, DOCX, TXT or MD. Up to ${maxFiles} files, ${limitMb} MB each.`}
            </span>
          </>
        )}

        {state === 'error' && (
          <>
            <span className="flex size-10 items-center justify-center rounded-full bg-danger-tint text-danger">
              <AlertIcon className="size-5" />
            </span>
            <span className="text-base font-semibold text-ink">Choose files or drop them here</span>
            <span id={helpId} className="text-sm text-ink-muted">
              {`PDF, DOCX, TXT or MD. Up to ${maxFiles} files, ${limitMb} MB each.`}
            </span>
          </>
        )}
      </button>

      <p role="status" aria-live="polite" className="sr-only">
        {isProcessing ? 'Uploading and indexing files.' : ''}
      </p>

      {serverError && (
        <div
          id={serverErrorId}
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-tint px-3 py-2.5 text-sm text-ink"
        >
          <AlertIcon className="mt-0.5 size-4 shrink-0 text-danger" />
          <p>
            <span className="font-semibold text-danger">Upload failed.</span> {serverError}
          </p>
        </div>
      )}

      {errors.length > 0 && (
        <div
          id={errorId}
          role="alert"
          className="mt-3 rounded-md border border-danger/40 bg-danger-tint px-3 py-2.5 text-sm text-ink"
        >
          <p className="flex items-center gap-2 font-semibold text-danger">
            <AlertIcon className="size-4 shrink-0" />
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
