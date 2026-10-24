import os from 'os'
import path from 'path'
import type { FeatureExtractionPipeline } from '@huggingface/transformers'

// Embeddings run inside this server with a small open-source model, so indexing
// a document needs no API key, costs nothing, and sends no document text to a
// third party. The model (about 23 MB) is downloaded from the Hugging Face hub
// on first use and cached in the temp directory, the only writable place on
// serverless hosts. A cold start pays that download once.
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'

let extractor: Promise<FeatureExtractionPipeline> | null = null

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    extractor = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.cacheDir = path.join(os.tmpdir(), 'transformers-cache')
      return pipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'q8' })
    })()
    // A failed load (network, disk) must not be cached forever
    extractor.catch(() => {
      extractor = null
    })
  }
  return extractor
}

// Cut-offs for this model's cosine similarities. Measured against faq.md:
// passages that answer a question scored 0.18 to 0.57, while the best passage
// for an unrelated question (capital of France, a pizza recipe) scored under
// 0.10. Changing the model changes this scale, so re-measure before editing.
export const MIN_SIMILARITY = 0.15
export const STRONG_SIMILARITY = 0.5

/**
 * The retrieval match score shown in the UI, 0-100: where the best passage
 * sits between MIN_SIMILARITY and STRONG_SIMILARITY. It says how closely a
 * passage matches the question, not whether the answer is correct.
 */
export function matchScore(similarities: number[]): number {
  if (similarities.length === 0) return 0
  const top = Math.max(...similarities)
  const scaled = (top - MIN_SIMILARITY) / (STRONG_SIMILARITY - MIN_SIMILARITY)
  return Math.round(Math.min(1, Math.max(0, scaled)) * 100)
}

/** Embed one text as a normalised 384-dimension vector. Throws on failure. */
export async function generateEmbeddings(text: string): Promise<number[]> {
  const [embedding] = await generateEmbeddingsBatch([text])
  return embedding
}

/** Embed several texts in one pass. Throws on failure; never returns placeholders. */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const embed = await getExtractor()
  const output = await embed(texts.map((text) => text.trim()), { pooling: 'mean', normalize: true })
  return output.tolist() as number[][]
}
