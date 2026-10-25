import { transformersEmbedder } from './embed.js'

// Downloads and loads the embedding model once, so the first upload or search
// does not have to. The Docker image runs it at build time; outside Docker run
// `npm run warm-model` with the same TRANSFORMERS_CACHE_DIR as the server.

async function main(): Promise<void> {
  const embedder = transformersEmbedder(process.env.TRANSFORMERS_CACHE_DIR?.trim() || null)
  const [vector] = await embedder.embed(['warm'])
  console.log(`connector warm-model ok dim=${vector.length}`)
}

main().catch((error) => {
  console.error(`connector warm-model failed: ${error instanceof Error ? error.name : 'unknown'}`)
  process.exit(1)
})
