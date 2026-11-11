// Starter questions ("Try asking") an owner sets in the builder. They travel
// in the embed code as data-question-1..4 attributes on the <script> tag, not
// in storage: no schema change for anyone's database, and an owner can edit
// them on their own site without regenerating the embed. The widget reads
// them back with the same limits (MAX_STARTER_QUESTIONS, MAX_STARTER_LENGTH)
// and renders them as plain text only.

export const MAX_STARTER_QUESTIONS = 4
export const MAX_STARTER_LENGTH = 120

// Trim, collapse whitespace, drop empties, cap each at MAX_STARTER_LENGTH and
// keep at most MAX_STARTER_QUESTIONS.
export function normalizeStarterQuestions(questions: readonly unknown[]): string[] {
  const out: string[] = []
  for (const q of questions) {
    if (typeof q !== 'string') continue
    const clean = q.replace(/\s+/g, ' ').trim().slice(0, MAX_STARTER_LENGTH).trim()
    if (clean && !out.includes(clean)) out.push(clean)
    if (out.length === MAX_STARTER_QUESTIONS) break
  }
  return out
}

// Escape for a double-quoted HTML attribute value.
function attr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Insert the questions into an embed code of the form <script src="..." async></script>.
// Returns the code unchanged when there are none.
export function withStarterQuestions(embedCode: string, questions: readonly unknown[]): string {
  const qs = normalizeStarterQuestions(questions)
  if (!qs.length || !embedCode.startsWith('<script ')) return embedCode
  const attrs = qs.map((q, i) => ` data-question-${i + 1}="${attr(q)}"`).join('')
  return embedCode.replace(/^<script /, `<script${attrs} `)
}
