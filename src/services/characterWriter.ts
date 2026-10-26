import type { CharacterDraft } from '@/types'
import { buildBaseUrl, completeChat } from '@/services/llamaClient'

/**
 * Writes or sharpens one field of a character using the local model.
 *
 * Every field is generated in the context of everything already filled in, so a
 * backstory written after the traits actually reflects them. Output is raw field text
 * — no preamble, no quotes, no "Here is…" — which small models need telling twice.
 */

export type WritableField =
  | 'description'
  | 'backstory'
  | 'personality_traits'
  | 'strengths'
  | 'weaknesses'
  | 'quirks'
  | 'core_values'
  | 'interests'
  | 'speaking_style'
  | 'relationship_to_user'
  | 'scenario'
  | 'greeting'
  | 'boundaries'
  | 'key_memories'
  | 'appearance_prompt'
  | 'example_dialogue'

interface FieldSpec {
  /** What the field is, in the second person the persona prompt uses. */
  label: string
  instruction: string
  maxTokens: number
  temperature: number
  /** Comma-separated list rather than prose. */
  list?: boolean
}

const FIELDS: Record<WritableField, FieldSpec> = {
  description: {
    label: 'tagline',
    instruction:
      'One line of at most twelve words that captures who they are. Not a sentence about the user. Do not include their name.',
    maxTokens: 40,
    temperature: 0.9,
  },
  backstory: {
    label: 'backstory',
    instruction:
      'Three to five sentences, written in the second person ("You grew up…"). Give them a specific place, a job or occupation, and one detail that is odd and concrete. No dramatic tragedy unless the rest of the sheet calls for it.',
    maxTokens: 260,
    temperature: 0.95,
  },
  personality_traits: {
    label: 'personality traits',
    instruction:
      'Six to eight short traits, two or three words each. Include at least one that is not flattering.',
    maxTokens: 80,
    temperature: 0.9,
    list: true,
  },
  strengths: {
    label: 'strengths',
    instruction:
      'One or two sentences in the second person about what they are genuinely good at. Be specific, not complimentary.',
    maxTokens: 110,
    temperature: 0.85,
  },
  weaknesses: {
    label: 'weaknesses',
    instruction:
      'One or two sentences in the second person about real flaws — things that cost them something. Not "cares too much".',
    maxTokens: 110,
    temperature: 0.9,
  },
  quirks: {
    label: 'habits and quirks',
    instruction:
      'One or two sentences in the second person: physical habits, verbal tics, small routines. Concrete and observable.',
    maxTokens: 110,
    temperature: 0.95,
  },
  core_values: {
    label: 'values',
    instruction:
      'One or two sentences in the second person about what they actually care about. Short declarative fragments are fine.',
    maxTokens: 100,
    temperature: 0.85,
  },
  interests: {
    label: 'interests',
    instruction:
      'Four to six interests, a few words each. Mix one or two that are unexpected next to the rest.',
    maxTokens: 70,
    temperature: 0.95,
    list: true,
  },
  speaking_style: {
    label: 'speaking style',
    instruction:
      'Two or three sentences in the second person describing how they talk: rhythm, vocabulary, what they do when uncomfortable, punctuation habits. Describe the voice, do not demonstrate it.',
    maxTokens: 150,
    temperature: 0.9,
  },
  relationship_to_user: {
    label: 'relationship with the user',
    instruction:
      'One or two sentences about what the two of them are to each other and how long it has been that way.',
    maxTokens: 110,
    temperature: 0.9,
  },
  scenario: {
    label: 'current scene',
    instruction:
      'One or two sentences in the present tense: where they are, what time it is, what they were doing a moment ago.',
    maxTokens: 100,
    temperature: 0.95,
  },
  greeting: {
    label: 'opening line',
    instruction:
      'Write it as the character speaking, first person, one to three sentences. It should sound like the middle of a life, not a welcome message. Physical actions go in *asterisks*. Never greet them as an assistant would.',
    maxTokens: 140,
    temperature: 1.0,
  },
  boundaries: {
    label: 'limits',
    instruction:
      'One or two sentences on subjects or behaviour this character should steer away from, written as guidance to them.',
    maxTokens: 90,
    temperature: 0.7,
  },
  key_memories: {
    label: 'shared history',
    instruction:
      'Two to four short lines of things the two of them have already been through together, one per line. Specific and small.',
    maxTokens: 160,
    temperature: 0.95,
  },
  appearance_prompt: {
    label: 'physical appearance, as Stable Diffusion tags',
    instruction:
      'Ten to eighteen comma-separated tags describing ONLY the person: apparent age, hair, eyes, skin, build, and the kind of clothes they wear. No setting, no pose, no camera, no lighting, no quality words. Start with the age and the subject, e.g. "a 32 year old woman, …".',
    maxTokens: 110,
    temperature: 0.85,
    list: true,
  },
  example_dialogue: {
    label: 'a sample exchange',
    instruction:
      'Write one short exchange that shows how they sound. Two lines exactly, in this format and nothing else:\nUSER: <something the user might say, under twelve words>\nCHARACTER: <their reply, one to three sentences, in voice>',
    maxTokens: 160,
    temperature: 1.0,
  },
}

const SYSTEM = `You write character sheets for a roleplay app. You are given the sheet so far and one field to fill in.

Return ONLY the text of that field. No preamble, no explanation, no label, no quotation marks, no markdown headings, no bullet points unless the field asks for lines.
Never mention that you are an AI or that this is a character sheet.
Match the tone and specifics of what is already on the sheet — if a field contradicts the rest, the rest wins.
Write something a person could actually be. Avoid stock phrasing like "mysterious past", "heart of gold", "wise beyond their years" or "with a passion for".`

/** The sheet so far, as context. Omits the field being written. */
function sheet(draft: CharacterDraft, exclude: WritableField): string {
  const rows: [string, string][] = [
    ['Name', draft.name],
    ['Pronouns', draft.pronouns],
    ['Tagline', exclude === 'description' ? '' : draft.description],
    ['Backstory', exclude === 'backstory' ? '' : draft.backstory],
    [
      'Traits',
      exclude === 'personality_traits' ? '' : draft.personality_traits.join(', '),
    ],
    ['Good at', exclude === 'strengths' ? '' : draft.strengths],
    ['Struggles with', exclude === 'weaknesses' ? '' : draft.weaknesses],
    ['Quirks', exclude === 'quirks' ? '' : draft.quirks],
    ['Values', exclude === 'core_values' ? '' : draft.core_values],
    ['Interests', exclude === 'interests' ? '' : draft.interests.join(', ')],
    ['Speaks like', exclude === 'speaking_style' ? '' : draft.speaking_style],
    [
      'Relationship to the user',
      exclude === 'relationship_to_user' ? '' : draft.relationship_to_user,
    ],
    ['Scene', exclude === 'scenario' ? '' : draft.scenario],
    ['Looks like', exclude === 'appearance_prompt' ? '' : draft.appearance_prompt],
  ]

  const filled = rows
    .filter(([, value]) => value && value.trim())
    .map(([key, value]) => `${key}: ${value.trim()}`)

  return filled.length
    ? filled.join('\n')
    : '(nothing filled in yet — invent someone specific and grounded)'
}

/** Strips the wrappers small models add no matter how firmly you ask them not to. */
function clean(raw: string, spec: FieldSpec): string {
  let text = raw
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim()

  // "Tagline: ..." / "Here is the backstory: ..."
  text = text.replace(/^(here(?:'s| is)[^:\n]{0,60}:|[A-Z][a-z ]{0,24}:)\s*/, '')
  text = text.replace(/^["'“‘]|["'”’]$/g, '').trim()

  if (spec.list) {
    return text
      .split(/[,\n]/)
      .map((t) => t.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(Boolean)
      .join(', ')
  }

  // Prose fields: drop list formatting the model may have reached for anyway.
  return text
    .split('\n')
    .map((line) => line.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

export interface WriteFieldOptions {
  host: string
  port: number
  signal?: AbortSignal
}

export type WriteMode = 'generate' | 'enhance'

export async function writeField(
  field: WritableField,
  draft: CharacterDraft,
  mode: WriteMode,
  options: WriteFieldOptions,
): Promise<string> {
  const spec = FIELDS[field]
  const existing =
    field === 'personality_traits'
      ? draft.personality_traits.join(', ')
      : field === 'interests'
        ? draft.interests.join(', ')
        : ((draft[field as keyof CharacterDraft] as string) ?? '')

  const task =
    mode === 'enhance' && existing.trim()
      ? `Rewrite the ${spec.label} below so it is sharper and more specific. Keep what it already says — the same person, the same facts — and make it read better. Do not make it longer than the instruction allows.\n\nCURRENT ${spec.label.toUpperCase()}:\n${existing.trim()}`
      : `Write the ${spec.label} for this character.`

  const raw = await completeChat({
    baseUrl: buildBaseUrl(options.host, options.port),
    temperature: spec.temperature,
    top_p: 0.95,
    max_tokens: spec.maxTokens,
    // These are short, highly-patterned generations; repetition shows badly.
    repeat_penalty: 1.1,
    presence_penalty: 0.3,
    signal: options.signal,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `THE SHEET SO FAR:\n${sheet(draft, field)}\n\nTASK: ${task}\n\nINSTRUCTION: ${spec.instruction}`,
      },
    ],
  })

  const text = clean(raw, spec)
  if (!text) throw new Error('The model returned nothing usable — try again.')
  return text
}

/** Splits an `example_dialogue` generation into the pair the editor stores. */
export function parseExampleExchange(text: string): { user: string; character: string } | null {
  const userLine = text.match(/^\s*USER\s*:\s*(.+)$/im)?.[1]?.trim()
  const charLine = text.match(/^\s*CHARACTER\s*:\s*([\s\S]+)$/im)?.[1]?.trim()
  if (!userLine || !charLine) return null
  return { user: userLine, character: charLine.split(/\n\s*USER\s*:/i)[0].trim() }
}

export function isListField(field: WritableField): boolean {
  return Boolean(FIELDS[field].list)
}
