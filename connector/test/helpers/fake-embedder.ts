import type { Embedder } from '../../src/embed.js'

export const FAKE_DIM = 384

function hashWord(word: string): number {
  let h = 2166136261
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % FAKE_DIM
}

/** Deterministic bag-of-words vectors, normalised, 384 dimensions. No model, no network. */
export function fakeVector(text: string): number[] {
  const v = new Array<number>(FAKE_DIM).fill(0)
  for (const word of text.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) v[hashWord(word)] += 1
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  if (norm === 0) {
    v[FAKE_DIM - 1] = 1
    return v
  }
  return v.map((x) => x / norm)
}

export class FakeEmbedder implements Embedder {
  calls: string[][] = []
  fail = false

  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push([...texts])
    if (this.fail) throw new Error('fake embedder failure')
    return texts.map(fakeVector)
  }
}
