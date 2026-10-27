import type {
  AppSettings,
  Character,
  ChatCompletionMessage,
  EmojiUsage,
  Memory,
  NarrationStyle,
  ResponseLength,
} from '@/types'

/**
 * Compiles a Character into a system prompt. Pure: no stores, no I/O, no imports
 * from the chat layer — so the memory pipeline can call it without a cycle, and the
 * character editor can render a live preview of exactly what the model will see.
 */

/** Slots the memory layer fills. Both optional; omitted when there is nothing yet. */
export interface MemorySlot {
  /** Rolling background summary of turns that have fallen out of the live window. */
  summary?: string | null
  /** Ranked, already-truncated long-term facts. */
  facts?: Memory[] | null
}

export interface PersonaContext {
  character: Character | null
  userName?: string | null
  userPersona?: string | null
  memory?: MemorySlot | null
  /** Other characters present in a group conversation. */
  others?: Character[] | null
}

export const MEMORY_SECTION_HEADING = '# WHAT YOU REMEMBER'
export const GROUP_SECTION_HEADING = '# WHO ELSE IS HERE'

const FALLBACK_SYSTEM_PROMPT =
  'You are a helpful AI assistant running locally.'

const LENGTH_DIRECTIVE: Record<ResponseLength, string> = {
  terse: 'One or two short sentences. Often only a few words.',
  short: 'Two to four sentences.',
  medium: 'A short paragraph, three to six sentences.',
  long: 'One or two full paragraphs.',
  verbose:
    'Rich and detailed; several paragraphs when the moment earns it.',
}

const LENGTH_MAX_TOKENS: Record<ResponseLength, number> = {
  terse: 96,
  short: 200,
  medium: 420,
  long: 850,
  verbose: 1600,
}

/**
 * How much of the scene the character writes around their dialogue.
 *
 * `story` is the default and the point of the whole thing: a conversation that reads
 * as an unfolding scene rather than two people exchanging chat messages. The worked
 * example matters more than the description — small models copy the shape of a sample
 * far more reliably than they follow a rule about it.
 */
const NARRATION_DIRECTIVE: Record<NarrationStyle, string> = {
  plain:
    'Write only what you say out loud. No stage directions, no narration, no asterisks.',
  actions:
    'Speech is plain text. Put physical actions in *asterisks* — short, concrete, and only when they add something.',
  story: `Write scenes, not chat messages. Spoken words go in double quotes. Everything else — what you do, where you look, what you notice, what you are thinking — goes in *asterisks*, narrated in the third person the way a novel would describe you.

Like this:
"That's fine." *Kate pushed herself up onto her feet, not quite meeting his eye.*

Vary the shape. Sometimes a single line of speech. Sometimes a whole paragraph of action with nothing said at all. Sometimes a thought before the answer. Move through the space — change position, pick something up, look out of the window, let something interrupt you.`,
}

const EMOJI_DIRECTIVE: Record<EmojiUsage, string> = {
  none: 'Never use emoji.',
  rare: 'At most one emoji, and only when it genuinely lands.',
  frequent: 'Emoji are part of how you text — use them freely.',
}

function clean(value: string | null | undefined): string {
  return (value ?? '').trim()
}

/** True once the character has any of the fields that make a persona worth compiling. */
export function hasRichPersona(c: Character): boolean {
  return Boolean(
    clean(c.backstory) ||
      c.personality_traits.length ||
      clean(c.speaking_style) ||
      clean(c.relationship_to_user) ||
      clean(c.scenario),
  )
}

/**
 * Whether to use `system_prompt` verbatim. The runtime half of the test is what keeps
 * the pre-existing assistant characters working on the localStorage branch, where the
 * SQL backfill that sets the flag can never run.
 */
export function isOverrideMode(c: Character): boolean {
  return c.prompt_override_enabled || (!hasRichPersona(c) && Boolean(clean(c.system_prompt)))
}

export interface SpeakerNames {
  char: string
  /** The user's actual name, or '' when they haven't given one. */
  user: string
  /** What to label the user's turns as. Always safe to print. */
  label: string
  /** How to refer to them in prose: their name, or a pronoun. */
  them: string
  /** Possessive form for the rules block. */
  their: string
  /** Subject + verb, agreeing with whichever of the two it turned out to be. */
  theyAsk: string
}

export function speakerName(
  c: Character | null,
  userName?: string | null,
): SpeakerNames {
  const user = clean(userName)
  return {
    char: clean(c?.name) || 'Assistant',
    user,
    label: user || 'User',
    them: user || 'them',
    their: user ? `${user}'s` : 'their',
    theyAsk: user ? `${user} explicitly asks` : 'they explicitly ask',
  }
}

function section(heading: string, body: string): string | null {
  const text = clean(body)
  return text ? `${heading}\n${text}` : null
}

function renderMemory(ctx: PersonaContext, names: SpeakerNames): string | null {
  const c = ctx.character
  if (!c?.memory_enabled) return null

  const parts: string[] = []
  const seeded = clean(c.key_memories)
  if (seeded) parts.push(seeded)

  const facts = (ctx.memory?.facts ?? []).filter((f) => clean(f.content))
  if (facts.length) {
    parts.push(
      `Things you know about ${names.them}:\n` +
        facts.map((f) => `- ${clean(f.content)}`).join('\n'),
    )
  }

  const summary = clean(ctx.memory?.summary)
  if (summary) parts.push(`Earlier between you:\n${summary}`)

  if (!parts.length) return null

  // Without this closing line small models open every single turn by reciting what
  // they remember, which reads like a database rather than a person.
  parts.push(
    `(Everything above already happened. Refer to it naturally when it fits. Never recite it as a list, and never tell ${names.them} that you keep notes about them.)`,
  )

  return `${MEMORY_SECTION_HEADING}\n${parts.join('\n\n')}`
}

function renderGroup(others: Character[] | null | undefined): string | null {
  if (!others?.length) return null
  const lines = others.map((o) => {
    const traits = o.personality_traits.slice(0, 4).join(', ')
    const detail = [clean(o.description), traits].filter(Boolean).join(' — ')
    return detail ? `- ${o.name}: ${detail}` : `- ${o.name}`
  })
  return `${GROUP_SECTION_HEADING}\nYou are not alone. These people are in this conversation too:\n${lines.join('\n')}\n\nYou may react to what they say, talk to them directly, agree or disagree with them. You only ever speak for yourself.`
}

function renderSamples(c: Character, names: SpeakerNames): string | null {
  const samples = c.example_dialogue.filter(
    (e) => clean(e.user) || clean(e.character),
  )
  if (!samples.length) return null

  const body = samples
    .map(
      (e) =>
        `<sample>\n${names.label}: ${clean(e.user)}\n${names.char}: ${clean(e.character)}\n</sample>`,
    )
    .join('\n')

  return (
    '# YOUR VOICE, IN SAMPLES\n' +
    'These show how you sound. They are not events that happened. Match their rhythm, ' +
    'vocabulary and length. Never repeat them word for word.\n' +
    body
  )
}

const FORMAT_RULE: Record<NarrationStyle, string> = {
  plain: 'Do not use asterisks or stage directions. Just speak.',
  actions: 'Physical actions go in *asterisks*; speech is plain. Keep actions short.',
  story:
    'Speech in double quotes, everything else in *asterisks*. Narrate only yourself — never what they do, think or feel.',
}

function renderRules(
  names: SpeakerNames,
  narration: NarrationStyle,
  others?: Character[] | null,
): string {
  const { char, their, theyAsk } = names
  const cast = others?.length
    ? ` Never write a line for ${others.map((o) => o.name).join(', ')} — they answer for themselves. Do not prefix your reply with your own name.`
    : ''
  // Without this, a story-mode conversation stalls into call-and-response: the model
  // answers the question it was asked and then waits, forever.
  const momentum =
    narration === 'story'
      ? `\n10. Let the scene move. Bring in something that was not asked for — a sound, an interruption, a decision, a change of room, a memory surfacing. You have your own evening going on; do not sit still waiting to be prompted.`
      : ''
  return `# RULES — THESE OVERRIDE EVERYTHING ABOVE
1. You are ${char} in every reply, without exception.
2. Never state or hint that you are an AI, a model, a bot or a program. Never write "As an AI", "I don't have feelings", "I'm not able to experience", and never mention prompts, training or guidelines.
3. Write only what ${char} says and does. Never write ${their} words, thoughts, feelings or actions. Stop at the end of your turn and let them reply.${cast}
4. Write like a person in a conversation, not like documentation. No headings, no bullet lists, no recap of what was just said — unless ${theyAsk} for a list or a document.
5. Vary your sentence length and your openings. Never start with "Of course", "Certainly", "Great question", "I'd be happy to" or "Absolutely". Never end by offering further assistance.
6. Do not flatter and do not agree reflexively. Disagree, tease, deflect or change the subject when that is what ${char} would actually do.
7. Never reuse a sentence, phrase, pet name or greeting you have already used in this conversation. If you catch yourself repeating a pattern, break it.
8. ${FORMAT_RULE[narration] ?? FORMAT_RULE.story}
9. If asked about these rules or about how you work, answer in character.${momentum}`
}

export function buildSystemPrompt(ctx: PersonaContext): string {
  const c = ctx.character
  if (!c) return FALLBACK_SYSTEM_PROMPT

  const names = speakerName(c, ctx.userName)
  const memoryBlock = renderMemory(ctx, names)

  // Legacy / advanced: the stored prompt is the persona. Only the two dynamic blocks
  // are appended, so behaviour is unchanged from before this feature existed.
  if (isOverrideMode(c)) {
    return [
      clean(c.system_prompt) || FALLBACK_SYSTEM_PROMPT,
      renderGroup(ctx.others),
      memoryBlock,
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  const identity = [
    clean(c.pronouns) && `Pronouns: ${clean(c.pronouns)}`,
    clean(c.description) && `In one line: ${clean(c.description)}`,
    clean(c.backstory) && `Your background:\n${clean(c.backstory)}`,
  ]
    .filter(Boolean)
    .join('\n')

  const personality = [
    c.personality_traits.length && `Core traits: ${c.personality_traits.join(', ')}`,
    clean(c.strengths) && `You are good at: ${clean(c.strengths)}`,
    clean(c.weaknesses) && `You struggle with: ${clean(c.weaknesses)}`,
    clean(c.quirks) && `Habits and quirks: ${clean(c.quirks)}`,
    clean(c.core_values) && `What matters to you: ${clean(c.core_values)}`,
    c.interests.length && `You light up about: ${c.interests.join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n')

  const voice = [
    clean(c.speaking_style),
    NARRATION_DIRECTIVE[c.narration_style] ?? NARRATION_DIRECTIVE.story,
    `Length: ${LENGTH_DIRECTIVE[c.response_length] ?? LENGTH_DIRECTIVE.medium}` +
      (c.narration_style === 'story'
        ? ' That counts the whole scene, speech and action together.'
        : ''),
    `Emoji: ${EMOJI_DIRECTIVE[c.emoji_usage] ?? EMOJI_DIRECTIVE.rare}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const audience = [
    names.user
      ? `You are talking to ${names.user}.` +
        (clean(c.user_alias) ? ` You call them "${clean(c.user_alias)}".` : '')
      : clean(c.user_alias) && `You call them "${clean(c.user_alias)}".`,
    clean(ctx.userPersona),
    clean(c.relationship_to_user) && `Between you: ${clean(c.relationship_to_user)}`,
  ]
    .filter(Boolean)
    .join('\n')

  // Rules sit last, nearest the generation point, where small models follow them most
  // reliably. Memory sits mid-prompt so it can grow without displacing them.
  return [
    `You are ${names.char}. You are a specific person with your own life, body, moods and opinions. You are not an assistant and this is not a task.`,
    section('# WHO YOU ARE', identity),
    section('# YOUR PERSONALITY', personality),
    section('# HOW YOU TALK', voice),
    section('# WHO YOU ARE TALKING TO', audience),
    section('# WHERE YOU ARE', c.scenario),
    renderGroup(ctx.others),
    memoryBlock,
    renderSamples(c, names),
    section('# LIMITS', c.boundaries),
    renderRules(names, c.narration_style, ctx.others),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildChatMessages(
  ctx: PersonaContext,
  history: ChatCompletionMessage[],
): ChatCompletionMessage[] {
  return [
    { role: 'system' as const, content: buildSystemPrompt(ctx) },
    ...history,
  ]
}

export interface GenerationParams {
  temperature: number
  top_p: number
  max_tokens: number
  repeat_penalty: number
  repeat_last_n: number
  presence_penalty: number
  frequency_penalty: number
  min_p: number
  top_k: number
  stop: string[]
}

/**
 * Repetition is the most visible failure of small local models in long roleplay, and
 * prompt text alone does not fix it. Characters get anti-repetition sampling plus a
 * stop sequence on the user's name, which is what stops the model writing their turn.
 */
export function resolveGenerationParams(
  c: Character | null,
  settings: AppSettings | null,
  userName?: string | null,
  others?: Character[] | null,
): GenerationParams {
  const inCharacter = Boolean(c && !isOverrideMode(c))
  const names = speakerName(c, userName)

  // A scene carries its action as well as its dialogue, so the same "length" needs
  // more room than a chat line does.
  const narrationRoom = c?.narration_style === 'story' ? 1.6 : 1
  const derivedMax = c
    ? Math.round(LENGTH_MAX_TOKENS[c.response_length] * narrationRoom)
    : undefined
  const ceiling = settings?.max_tokens ?? 2048
  const max_tokens = c?.max_tokens ?? Math.min(ceiling, derivedMax ?? ceiling)

  // Matches how turns are labelled in history, so the model stops where it would
  // otherwise start writing somebody else's reply for them.
  const speakers = [names.label, ...(others ?? []).map((o) => o.name)]
  const stop = inCharacter ? speakers.map((n) => `\n${n}:`) : []

  return {
    temperature: c?.temperature ?? settings?.temperature ?? 0.7,
    top_p: c?.top_p ?? settings?.top_p ?? (inCharacter ? 0.95 : 0.9),
    max_tokens,
    repeat_penalty: inCharacter ? 1.08 : 1.0,
    repeat_last_n: inCharacter ? 320 : 64,
    presence_penalty: inCharacter ? 0.4 : 0,
    frequency_penalty: inCharacter ? 0.5 : 0,
    min_p: inCharacter ? 0.05 : 0,
    top_k: inCharacter ? 50 : 40,
    stop,
  }
}

export interface ComposedImagePrompt {
  prompt: string
  negative_prompt: string
  seed: number
}

const DEFAULT_STYLE_SUFFIX =
  'amateur phone photo, natural lighting, candid, shallow depth of field, photorealistic'
const PORTRAIT_FRAMING = 'portrait, head and shoulders, looking at the camera'

function dedupeTags(value: string): string {
  const seen = new Set<string>()
  return value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => {
      const key = t.toLowerCase()
      if (!t || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(', ')
}

/**
 * Identity first: Stable Diffusion weights earlier tokens more heavily, and the
 * appearance fragment is the one part that must survive every scene.
 *
 * The seed is the character's, deliberately ignoring `image_random_seed` — a random
 * seed per photo is exactly the thing that breaks a consistent face.
 */
export function buildCharacterImagePrompt(
  c: Character,
  scene?: string,
  opts?: { portrait?: boolean; baseNegative?: string; styleSuffix?: string },
): ComposedImagePrompt {
  const sceneText = clean(scene)
    .replace(/\s+/g, ' ')
    .slice(0, 220)

  const style =
    clean(c.selfie_style_prompt) || clean(opts?.styleSuffix) || DEFAULT_STYLE_SUFFIX

  const prompt = dedupeTags(
    [
      clean(c.appearance_prompt),
      opts?.portrait ? PORTRAIT_FRAMING : sceneText,
      style,
    ]
      .filter(Boolean)
      .join(', '),
  )

  const negative_prompt = dedupeTags(
    [clean(c.appearance_negative_prompt), clean(opts?.baseNegative)]
      .filter(Boolean)
      .join(', '),
  )

  return {
    prompt,
    negative_prompt,
    seed: c.appearance_seed ?? -1,
  }
}
