import type { Character, ConversationSummary, Message } from '@/types'
import * as db from '@/services/database'
import { completeChat } from '@/services/llamaClient'

/**
 * Rolling background summary, so a months-long conversation keeps its thread after the
 * oldest turns have fallen out of the context window.
 *
 * First person and in character on purpose: a third-person bullet summary bleeds into
 * the reply style and makes the character start talking like a report.
 */

const SUMMARY_SYSTEM = (char: string, user: string) =>
  `You are the private memory of ${char}, a character in an ongoing conversation with ${user}.
You are writing notes to your future self so the conversation can continue without a break.

Rewrite the MEMORY SO FAR so it also covers the NEW EXCHANGES.

Rules:
- Write in first person as ${char}, past tense, plain prose. No bullet points, no headings, no markdown.
- 120-200 words. Never grow beyond 200 words: when you add something, compress or drop what matters least.
- Keep: what ${user} told you about themselves, what the two of you did and decided, promises either of you made, unresolved threads, running jokes, nicknames, the emotional temperature between you, and where you both are right now.
- Keep concrete nouns and names. Drop pleasantries, small talk, and anything already obvious from your own personality.
- Do not invent anything that is not in the text. Do not evaluate or moralise. Do not address anyone.
- If a later exchange contradicts an earlier note, keep the later version only.
- Output only the rewritten memory.`

/** Turns left raw in the live window and therefore not folded into the summary yet. */
export const KEEP_RAW_TAIL = 8

export const REFUSAL_MARKERS = [
  "i'm sorry",
  'i am sorry',
  'as an ai',
  'i cannot',
  "i can't help",
  'language model',
]

function sanitize(raw: string): string | null {
  const text = raw
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*•]\s+/, '').replace(/^#+\s*/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length < 20) return null
  const lower = text.toLowerCase()
  if (REFUSAL_MARKERS.some((marker) => lower.includes(marker))) return null
  return text
}

export interface SummarizeInput {
  conversationId: string
  character: Character
  userName: string
  /** Everything currently in the conversation, oldest first. */
  messages: Message[]
  baseUrl: string
  signal?: AbortSignal
}

/**
 * Folds the turns that are about to leave the live window into the stored summary.
 * Returns the new summary, or null when there was nothing to do or the write lost a
 * race with a newer one.
 */
export async function summarizeConversation(
  input: SummarizeInput,
): Promise<ConversationSummary | null> {
  const existing = await db.getConversationSummary(input.conversationId)
  const coveredUpTo = existing?.summarized_up_to_created_at ?? null

  const chronological = input.messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  )
  const foldable = chronological.slice(0, Math.max(0, chronological.length - KEEP_RAW_TAIL))
  const pending = coveredUpTo
    ? foldable.filter((m) => m.created_at > coveredUpTo)
    : foldable

  if (!pending.length) return null

  const names = { char: input.character.name, user: input.userName }
  const exchanges = pending
    .map((m) => `${m.role === 'user' ? names.user : names.char}: ${m.content}`)
    .join('\n')

  const raw = await completeChat({
    baseUrl: input.baseUrl,
    temperature: 0.3,
    top_p: 0.9,
    max_tokens: 320,
    signal: input.signal,
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM(names.char, names.user) },
      {
        role: 'user',
        content:
          `MEMORY SO FAR:\n${existing?.summary || '(nothing yet — this is the first time)'}` +
          `\n\nNEW EXCHANGES:\n${exchanges}`,
      },
    ],
  })

  const summary = sanitize(raw)
  // A bad generation keeps the previous summary rather than destroying it.
  if (!summary) return null

  const last = pending[pending.length - 1]
  return db.upsertConversationSummary({
    conversation_id: input.conversationId,
    summary,
    summarized_up_to_message_id: last.id,
    summarized_up_to_created_at: last.created_at,
    message_count: chronological.length,
    token_estimate: Math.ceil(summary.length / 3.6),
    expected_version: existing?.version ?? 0,
  })
}

/** Messages not yet folded into the summary — the trigger input and the fact window. */
export function uncoveredMessages(
  messages: Message[],
  summary: ConversationSummary | null,
): Message[] {
  const coveredUpTo = summary?.summarized_up_to_created_at ?? null
  const chronological = messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  )
  return coveredUpTo
    ? chronological.filter((m) => m.created_at > coveredUpTo)
    : chronological
}
