import { createHash } from 'node:crypto'
import type { VectorSearchResult } from '../../types/database'
import type { StoreKind } from './types'

const TOKEN_PREFIXES = ['sbw1_', 'sbw2_', 'sbw3_', 'sbb1_', 'sbm1_', 'sbc1_'] as const

export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

export function keyLabel(key: string): string {
  if (key.startsWith('widget-')) return key
  const prefix = TOKEN_PREFIXES.find((p) => key.startsWith(p))
  if (prefix) return `${prefix}#${fingerprint(key)}`
  return `#${fingerprint(key)}`
}

export function workspaceLabel(workspaceId: string): string {
  return 'ws=' + workspaceId.slice(0, 8)
}

export function retrievalLog(
  kind: StoreKind,
  route: 'widget' | 'preview',
  results: VectorSearchResult[],
  label: string,
): void {
  const hits = results.map((r) => `${r.chunk_index}:${r.similarity.toFixed(4)}`).join(',')
  console.log(`retrieval store=${kind} route=${route} chunks=${results.length} hits=[${hits}] key=${label}`)
}
