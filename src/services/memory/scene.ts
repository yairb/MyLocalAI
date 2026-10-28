import type { Character, Message } from '@/types'
import * as db from '@/services/database'
import { completeChat } from '@/services/llamaClient'
import { REFUSAL_MARKERS } from './summarizer'

/**
 * Keeps track of where a scene physically is.
 *
 * The summary records what happened; this records what is true *right now* — the room,
 * the hour, who is in it, what is in someone's hands. Without it a character walks into
 * the kitchen on one turn and answers the door from the sofa on the next, which breaks
 * immersion faster than any amount of clumsy prose.
 *
 * It is a snapshot, not a fold, so it reads a short fixed tail rather than everything
 * the summary has not covered, and it refreshes far more often than the summary does.
 */

/** Turns the snapshot is taken from. Enough for a scene change, cheap to evaluate. */
const WINDOW = 8

/** Hard ceiling on what gets stored, whatever the model returns. */
const MAX_CHARS = 300

const FIELDS = ['Place', 'Time', 'Present', 'Situation'] as const

const SCENE_SYSTEM = `You are the continuity log for a scene. Read the exchanges and report the state AS IT IS AT THE LAST LINE.

Output exactly these four lines and nothing else:
Place: <where they are, one short phrase>
Time: <time of day, one short phrase>
Present: <who is physically there, comma separated>
Situation: <what is physically happening right now — posture, what is in their hands, what is unfinished — one sentence>

Use only what the text says. If a line is genuinely unknown, write "unclear".
Never invent events, never summarise the conversation, never mention feelings. Under 60 words in total.`

/**
 * Four fixed labels make this trivial to validate: anything that is not one of them is
 * the model talking, and a generation that lost more than one field is a failed one.
 */
function sanitize(raw: string): string | null {
  const lines = raw
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*•]\s+/, '').trim())
    .filter((line) => FIELDS.some((f) => line.startsWith(`${f}:`)))

  if (lines.length < 3) return null

  const text = lines.join('\n').slice(0, MAX_CHARS)
  const lower = text.toLowerCase()
  if (REFUSAL_MARKERS.some((marker) => lower.includes(marker))) return null
  return text
}

export interface SceneInput {
  conversationId: string
  characters: Character[]
  userName: string
  /** Everything currently in the conversation, oldest first. */
  messages: Message[]
  baseUrl: string
  signal?: AbortSignal
}

export async function refreshScene(input: SceneInput): Promise<string | null> {
  const name = (m: Message): string => {
    if (m.role === 'user') return input.userName
    const character = input.characters.find((c) => c.id === m.character_id)
    return character?.name ?? input.characters[0]?.name ?? 'They'
  }

  const tail = input.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-WINDOW)

  if (tail.length < 2) return null

  const raw = await completeChat({
    baseUrl: input.baseUrl,
    temperature: 0.2,
    top_p: 0.9,
    max_tokens: 120,
    signal: input.signal,
    messages: [
      { role: 'system', content: SCENE_SYSTEM },
      {
        role: 'user',
        content: tail.map((m) => `${name(m)}: ${m.content}`).join('\n'),
      },
    ],
  })

  const scene = sanitize(raw)
  // A bad generation keeps whatever was there rather than blanking the scene.
  if (!scene) return null

  await db.setConversationScene(input.conversationId, scene)
  return scene
}
