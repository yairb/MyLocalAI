import type { Character, Message, NarrationStyle } from '@/types'
import { buildBaseUrl, completeChat } from '@/services/llamaClient'

/**
 * Drafts the user's own next message, or sharpens the one they have started.
 *
 * Deliberately a draft: the result goes into the composer for them to edit, never
 * straight into the conversation. The model is writing *as them*, which is exactly the
 * kind of thing you want a look at before it is said out loud.
 */

const RECENT_TURNS = 10
const MAX_TRANSCRIPT_CHARS = 2600

function transcript(
  messages: Message[],
  userLabel: string,
  nameOf: (id: string | null | undefined) => string | null,
): string {
  const lines = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-RECENT_TURNS)
    .map((m) =>
      m.role === 'user'
        ? `${userLabel}: ${m.content}`
        : `${nameOf(m.character_id) ?? 'They'}: ${m.content}`,
    )
    .join('\n')

  return lines.length > MAX_TRANSCRIPT_CHARS
    ? `…\n${lines.slice(-MAX_TRANSCRIPT_CHARS)}`
    : lines
}

const NARRATION_NOTE: Record<NarrationStyle, string> = {
  plain: 'Write only speech. No asterisks, no stage directions.',
  actions:
    'Speech is plain. You may add one short physical action in *asterisks* if it fits.',
  story:
    'Match the scene: spoken words in double quotes, actions and thoughts in *asterisks*, narrated in the third person. Keep it shorter than their reply would be.',
}

export interface SuggestReplyInput {
  /** Everyone the user is talking to, for voice and context. */
  characters: Character[]
  messages: Message[]
  /** What they have typed so far. Empty means write something from scratch. */
  draft?: string
  userName: string
  userPersona?: string
  host: string
  port: number
  signal?: AbortSignal
}

export type SuggestMode = 'generate' | 'enhance'

export function suggestMode(draft: string | undefined): SuggestMode {
  return draft?.trim() ? 'enhance' : 'generate'
}

export async function suggestUserMessage(
  input: SuggestReplyInput,
): Promise<string> {
  const mode = suggestMode(input.draft)
  const userLabel = input.userName.trim() || 'You'
  const nameOf = (id: string | null | undefined) =>
    input.characters.find((c) => c.id === id)?.name ?? null

  // In a group, follow whoever is actually setting the tone of the scene.
  const lastSpeakerId = [...input.messages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.character_id)?.character_id
  const lead =
    input.characters.find((c) => c.id === lastSpeakerId) ?? input.characters[0]
  const narration: NarrationStyle = lead?.narration_style ?? 'actions'
  const cast = input.characters.map((c) => c.name).join(', ') || 'them'

  const system = `You are helping ${userLabel} write their own next message in an ongoing conversation with ${cast}.

Write as ${userLabel}, in the first person. Return ONLY the message itself — no preamble, no quotation marks around the whole thing, no explanation, no label, no alternatives to choose from.
Never write ${cast}'s reply, actions or thoughts. You are only writing ${userLabel}'s side.
Keep it to one short paragraph at most. Sound like a person talking, not like someone composing.
${NARRATION_NOTE[narration]}${
    input.userPersona?.trim() ? `\n\nAbout ${userLabel}: ${input.userPersona.trim()}` : ''
  }`

  const history = transcript(input.messages, userLabel, nameOf)
  const task =
    mode === 'enhance'
      ? `Rewrite this draft so it reads better and fits the conversation. Keep what they meant and the information in it — do not change the subject, do not add new facts.\n\nDRAFT:\n${input.draft?.trim()}`
      : history
        ? 'Write what they say next. Respond to what was just said, and give the conversation somewhere to go.'
        : 'Open the conversation. One or two sentences.'

  const raw = await completeChat({
    baseUrl: buildBaseUrl(input.host, input.port),
    temperature: mode === 'enhance' ? 0.75 : 0.95,
    top_p: 0.95,
    max_tokens: 220,
    repeat_penalty: 1.08,
    presence_penalty: 0.3,
    signal: input.signal,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: history
          ? `THE CONVERSATION SO FAR:\n${history}\n\nTASK: ${task}`
          : `TASK: ${task}`,
      },
    ],
  })

  const text = raw
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .replace(/^\s*(?:you|me|user)\s*:\s*/i, '')
    .trim()
    // A whole-message wrap in quotes is the model quoting itself, not dialogue.
    .replace(/^"([\s\S]+)"$/, '$1')
    .trim()

  if (!text) throw new Error('The model returned nothing usable — try again.')
  return text
}
