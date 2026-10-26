import type { Character, ChatCompletionMessage, Message } from '@/types'

/**
 * Deciding who speaks next in a group conversation.
 *
 * Heuristic rather than a director call to the model: picking a speaker would cost a
 * full prompt evaluation before a single token of the actual reply, which on a local
 * model is most of the latency of the turn. Being addressed by name covers the case
 * people actually care about, and rotation handles the rest.
 */

/** Finds a participant named in the text, preferring the earliest mention. */
export function addressedCharacter(
  text: string,
  participants: Character[],
): Character | null {
  let best: { character: Character; at: number } | null = null

  for (const character of participants) {
    const name = character.name.trim()
    if (name.length < 2) continue
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    const match = pattern.exec(text)
    if (match && (!best || match.index < best.at)) {
      best = { character, at: match.index }
    }
  }

  return best?.character ?? null
}

/** Index of the last message each character spoke, for least-recently-spoken order. */
function lastSpokeAt(messages: Message[]): Map<string, number> {
  const seen = new Map<string, number>()
  messages.forEach((message, index) => {
    if (message.role === 'assistant' && message.character_id) {
      seen.set(message.character_id, index)
    }
  })
  return seen
}

export interface PickSpeakerInput {
  participants: Character[]
  messages: Message[]
  /** The message just sent, if this is the first reply of the turn. */
  userText?: string
  /** Characters that have already replied this turn and should not go again. */
  exclude?: string[]
}

export function pickSpeaker(input: PickSpeakerInput): Character | null {
  const available = input.participants.filter(
    (c) => !input.exclude?.includes(c.id),
  )
  if (!available.length) return null
  if (available.length === 1) return available[0]

  if (input.userText) {
    const addressed = addressedCharacter(input.userText, available)
    if (addressed) return addressed
  }

  const seen = lastSpokeAt(input.messages)
  const lastSpeaker = [...input.messages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.character_id)?.character_id

  // Rotate: whoever has been quiet longest, and never the same voice twice running.
  const candidates = available.filter((c) => c.id !== lastSpeaker)
  const pool = candidates.length ? candidates : available
  return pool.reduce((quietest, c) =>
    (seen.get(c.id) ?? -1) < (seen.get(quietest.id) ?? -1) ? c : quietest,
  )
}

export interface RenderGroupHistoryInput {
  messages: Message[]
  /** Whose point of view the transcript is built from. */
  speakerId: string
  userLabel: string
  characterName: (id: string | null | undefined) => string | null
}

/**
 * Renders history from one character's point of view: their own turns are the
 * assistant's, and everything else — the user and the other characters — arrives as
 * labelled input.
 */
export function renderGroupMessage(
  message: Message,
  input: Omit<RenderGroupHistoryInput, 'messages'>,
): ChatCompletionMessage | null {
  if (message.role === 'user') {
    return { role: 'user', content: `${input.userLabel}: ${message.content}` }
  }
  if (message.role !== 'assistant') return null

  const photo = message.image?.caption
    ? `\n[sent a photo: ${message.image.caption}]`
    : ''

  if (message.character_id === input.speakerId) {
    const own = message.image?.caption
      ? `${message.content}\n[you sent a photo: ${message.image.caption}]`
      : message.content
    return { role: 'assistant', content: own }
  }

  const name = input.characterName(message.character_id) ?? 'Someone'
  return { role: 'user', content: `${name}: ${message.content}${photo}` }
}

/**
 * Merges runs of same-role turns into one message. Several `user` messages in a row
 * are normal in a group transcript, but some chat templates assume strict alternation,
 * so they are folded into a single block before the request goes out.
 */
export function coalesce(
  messages: ChatCompletionMessage[],
): ChatCompletionMessage[] {
  const out: ChatCompletionMessage[] = []
  for (const message of messages) {
    const previous = out[out.length - 1]
    if (previous && previous.role === message.role && message.role !== 'system') {
      out[out.length - 1] = {
        role: previous.role,
        content: `${previous.content}\n${message.content}`,
      }
    } else {
      out.push(message)
    }
  }
  return out
}
