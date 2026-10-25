import os from 'node:os'
import path from 'node:path'
import type { FeatureExtractionPipeline } from '@huggingface/transformers'

// Parity with the app's src/lib/embeddings.ts: same model, quantisation, mean
// pooling, normalisation and trimming. The app's MIN_SIMILARITY (0.15) and
// STRONG_SIMILARITY (0.5) were calibrated for exactly this setup, so any
// change here moves the scores the app filters on.
// Texts are embedded one per call, as the app does. Batching pads shorter
// texts, and with the q8 model that moved faq.md search scores by up to 0.009,
// which is more than the parity the app's cut-offs assume.
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'

export interface Embedder {
  /** One normalised 384-dimension vector per text, in order. Throws on failure. */
  embed(texts: string[]): Promise<number[][]>
}

export function transformersEmbedder(cacheDir?: string | null): Embedder {
  let extractor: Promise<FeatureExtractionPipeline> | null = null

  const getExtractor = (): Promise<FeatureExtractionPipeline> => {
    if (!extractor) {
      const loading = (async () => {
        const { pipeline, env } = await import('@huggingface/transformers')
        env.cacheDir = cacheDir ?? path.join(os.tmpdir(), 'transformers-cache')
        return pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'q8' })
      })()
      extractor = loading
      // A failed load (network, disk) must not be cached forever.
      loading.catch(() => {
        if (extractor === loading) extractor = null
      })
    }
    return extractor
  }

  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return []
      const extract = await getExtractor()
      const vectors: number[][] = []
      for (const text of texts) {
        const output = await extract([text.trim()], { pooling: 'mean', normalize: true })
        vectors.push(...(output.tolist() as number[][]))
      }
      return vectors
    },
  }
}
