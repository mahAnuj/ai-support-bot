// What the chat says while an answer is on its way, by seconds waited. Shared
// by the embedded widget (src/lib/widget-script.ts) and the builder preview
// (src/components/ui/ChatInterface.tsx), so both say the same thing.
//
// Honest by design: the answer is not streamed, so nothing here claims
// progress the server has not reported. The later lines exist because the
// first question after a quiet spell is slower (the server and a free-plan
// database both wake up), and silence past a few seconds reads as broken.
export const WAITING_MESSAGES: readonly { after: number; text: string }[] = [
  { after: 0, text: 'Looking through the documents' },
  { after: 3, text: 'Writing an answer' },
  { after: 8, text: 'Still working. The first answer after a quiet spell can take a little longer.' },
  { after: 20, text: 'Taking longer than usual. Thanks for waiting.' },
]

/** The message to show after `seconds` of waiting. */
export function waitingMessage(seconds: number): string {
  let text = WAITING_MESSAGES[0].text
  for (const m of WAITING_MESSAGES) if (seconds >= m.after) text = m.text
  return text
}
