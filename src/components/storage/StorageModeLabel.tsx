'use client'

import type { JSX } from 'react'
import type { StorageConnection } from './useStorageConnection'

export interface StorageModeLabelProps {
  storage: StorageConnection
  place: 'documents' | 'embed'
}

const DEMO_TEXT = 'Demo: documents and this widget are deleted when the server restarts.'
const CONNECTED_TEXT: Record<StorageModeLabelProps['place'], string> = {
  documents: 'Stored in your database',
  embed: 'This widget answers from your database and keeps working after server restarts.',
}

export default function StorageModeLabel({ storage, place }: StorageModeLabelProps): JSX.Element | null {
  if (!storage.ready) return null

  const connected = storage.connected
  return (
    <p
      className={`mt-3 flex items-start gap-2 text-xs ${connected ? 'text-ink' : 'text-ink-muted'}`}
      data-storage-mode={connected ? 'postgres' : 'memory'}
    >
      <span
        aria-hidden="true"
        className={`mt-[5px] size-2 shrink-0 rounded-full ${connected ? 'bg-accent' : 'border border-line-strong bg-sunken'}`}
      />
      <span>{connected ? CONNECTED_TEXT[place] : DEMO_TEXT}</span>
    </p>
  )
}
