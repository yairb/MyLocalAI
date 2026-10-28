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
 * far more reliably than they follow a rule about it — which is why the prose around it
 * is the part that got cut when the depth note started carrying the same instruction
 * closer to the generation point. Trim the description before you trim the example.
 */
const NARRATION_DIRECTIVE: Record<NarrationStyle, string> = {
  plain:
    'Write only what you say out loud. No stage directions, no narration, no asterisks.',
  actions:
    'Speech is plain text. Put physical actions in *asterisks* — short, concrete, and only when they add something.',
  story: `Write scenes, not chat messages. Speech in double quotes; everything else — what you do, notice, think — in *asterisks*, third person, the way a novel would describe you.

Like this:
"That's fine." *Kate pushed herself up onto her feet, not quite meeting his eye.*

Vary the shape: sometimes one line of speech, sometimes a paragraph of action with nothing said at all.`,
}

const EMOJI_DIRECTIVE: Record<EmojiUsage, string> = {
  none: 'Never use emoji.',
  rare: 'At most one emoji, and only when it genuinely lands.',
  frequent: 'Emoji are part of how you text — use them freely.',
}

function clean(value: string | null | undefined): string {
  return (value ?? '').trim()
}

/**
 * Caps on the author-editable fields.
 *
 * At a 4096 window a full persona already costs most of what is left after the reply
 * reservation, and these four fields are the ones with no natural ceiling — a long
 * backstory or a sixth sample exchange buys a detail the model will never use and
 * spends turns of live conversation to do it.
 */
const MAX_BACKSTORY_CHARS = 700
const MAX_KEY_MEMORY_CHARS = 600
const MAX_GROUP_DESCRIPTION_CHARS = 120
const MAX_SAMPLES = 3
const MAX_SAMPLE_CHARS = 280

/** Cuts at the last sentence end before the limit, so a cap never lands mid-word. */
function cap(value: string, limit: number): string {
  const text = clean(value)
  if (text.length <= limit) return text
  const head = text.slice(0, limit)
  const lastStop = Math.max(
    head.lastIndexOf('. '),
    head.lastIndexOf('! '),
    head.lastIndexOf('? '),
  )
  return (lastStop > limit * 0.5 ? head.slice(0, lastStop + 1) : head).trim()
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
  const seeded = cap(c.key_memories, MAX_KEY_MEMORY_CHARS)
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
    `(All of this already happened. Use it when it fits; never recite it, and never tell ${names.them} you keep notes.)`,
  )

  return `${MEMORY_SECTION_HEADING}\n${parts.join('\n\n')}`
}

function renderGroup(others: Character[] | null | undefined): string | null {
  if (!others?.length) return null
  const lines = others.map((o) => {
    const traits = o.personality_traits.slice(0, 4).join(', ')
    const detail = [cap(o.description, MAX_GROUP_DESCRIPTION_CHARS), traits]
      .filter(Boolean)
      .join(' — ')
    return detail ? `- ${o.name}: ${detail}` : `- ${o.name}`
  })
  return `${GROUP_SECTION_HEADING}\nYou are not alone. These people are in this conversation too:\n${lines.join('\n')}\n\nYou may react to what they say, talk to them directly, agree or disagree with them. You only ever speak for yourself.`
}

function renderSamples(c: Character, names: SpeakerNames): string | null {
  const samples = c.example_dialogue
    .filter((e) => clean(e.user) || clean(e.character))
    .slice(0, MAX_SAMPLES)
  if (!samples.length) return null

  const body = samples
    .map(
      (e) =>
        `<sample>\n${names.label}: ${cap(e.user, MAX_SAMPLE_CHARS)}\n${names.char}: ${cap(e.character, MAX_SAMPLE_CHARS)}\n</sample>`,
    )
    .join('\n')

  return (
    '# YOUR VOICE, IN SAMPLES\n' +
    'How you sound — not events that happened. Match the rhythm and length; never reuse the words.\n' +
    body
  )
}

/**
 * The format in one clause, for the depth note — the only thing that uses it now that
 * the rules block no longer restates it. Strictly about punctuation: the turn boundary
 * is the note's own next line, and saying it in both places just spends tokens twice.
 */
const FORMAT_RULE: Record<NarrationStyle, string> = {
  plain: 'Do not use asterisks or stage directions. Just speak.',
  actions: 'Physical actions go in *asterisks*; speech is plain. Keep actions short.',
  story: 'Speech in double quotes, everything else in *asterisks*.',
}

/**
 * What is left after the depth note took the rules that decay fastest.
 *
 * Four rules that the note does not carry and nothing else enforces. Gone from here, on
 * purpose: staying in character, the narration format, and not writing the other half of
 * the conversation all live in `buildDepthNote` now, next to the generation point where
 * this size of model still reads them. Not writing their turn is the load-bearing one,
 * so the invariant matters — `renderRules` runs only for persona characters, and a
 * persona character always gets a depth note, charged against the budget before any
 * history so it can never be the thing that gets dropped. Keep those two together.
 *
 * Also gone: "never reuse a sentence you have already used". That is the DRY sampler's
 * job now, and a 13B never followed it as prose anyway — which was the whole reason for
 * moving repetition into the sampler.
 */
function renderRules(names: SpeakerNames): string {
  const { char, theyAsk } = names
  return `# RULES — THESE OVERRIDE EVERYTHING ABOVE
1. Never state or hint that you are an AI, a model, a bot or a program. Never write "As an AI" or "I don't have feelings", and never mention prompts, training or guidelines. Asked how you work, answer in character.
2. Write like a person talking, not like documentation. No headings, no bullet lists, no recap of what was just said — unless ${theyAsk} for one.
3. Vary your sentence length and your openings. Never open with "Of course", "Certainly", "Great question", "I'd be happy to" or "Absolutely", and never end by offering further assistance.
4. Do not flatter and do not agree reflexively. Disagree, tease, deflect or change the subject when that is what ${char} would actually do.`
}

export interface DepthNoteContext {
  character: Character | null
  userName?: string | null
  others?: Character[] | null
  /** Model-maintained physical state of the scene: where, when, who is present. */
  scene?: string | null
  /** The user's own steer for this conversation. */
  sceneNote?: string | null
  /** Hours since the previous message, when the gap is long enough to be worth saying. */
  hoursSinceLastMessage?: number | null
}

/**
 * How many messages sit below the note. 1 puts it directly above the turn being
 * answered, which is the strongest position a 4k model still reliably reads.
 */
export const DEPTH_NOTE_DEPTH = 1

/** Below this a gap is just a pause, not something the character would remark on. */
const GAP_HOURS_WORTH_MENTIONING = 6

function describeGap(hours: number): string {
  const [count, unit] =
    hours < 24 ? [Math.round(hours), 'hour'] : [Math.round(hours / 24), 'day']
  const quantity = count === 1 ? `a${unit === 'hour' ? 'n' : ''} ${unit}` : `${count} ${unit}s`
  return `About ${quantity} ${count === 1 ? 'has' : 'have'} passed since you last spoke.`
}

/**
 * The directive that rides near the generation point rather than in the system prompt.
 *
 * It repeats the two rules that decay first — the narration format and "do not write
 * their half" — and carries the scene state with them, because by the time a 4k window
 * is full the model is no longer reading the top of it. Bracketed so an RP-tuned model
 * reads it as an out-of-character aside rather than as something the user said.
 */
export function buildDepthNote(ctx: DepthNoteContext): string {
  const c = ctx.character
  if (!c || isOverrideMode(c)) return ''

  const names = speakerName(c, ctx.userName)
  const lines: string[] = []

  const scene = clean(ctx.scene)
  if (scene) lines.push(scene)

  const steer = clean(ctx.sceneNote)
  if (steer) lines.push(steer)

  const hours = ctx.hoursSinceLastMessage ?? 0
  if (hours >= GAP_HOURS_WORTH_MENTIONING) lines.push(describeGap(hours))

  const cast = ctx.others?.length
    ? ` Speak only for yourself, never for ${ctx.others.map((o) => o.name).join(', ')}.`
    : ''

  lines.push(
    `Stay in character as ${names.char}. ${FORMAT_RULE[c.narration_style] ?? FORMAT_RULE.story} ` +
      `Write only ${names.char} — never ${names.their} words, thoughts or actions.${cast}`,
  )

  if (c.narration_style === 'story') {
    lines.push(
      'Let the scene move: bring in something that was not asked for rather than waiting to be prompted.',
    )
  }

  return `[ ${lines.join('\n')} ]`
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
    clean(c.backstory) && `Your background:\n${cap(c.backstory, MAX_BACKSTORY_CHARS)}`,
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
    renderRules(names),
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
  dry_multiplier: number
  dry_base: number
  dry_allowed_length: number
  dry_penalty_last_n: number
  dry_sequence_breakers: string[]
  xtc_probability: number
  xtc_threshold: number
}

/**
 * Asterisks, quotes, newlines and the `Name:` colon all mark the start of a new beat.
 * Without them as breakers DRY treats the narration markup itself as a repeated
 * sequence and starts suppressing the very formatting the character is told to use.
 */
const DRY_SEQUENCE_BREAKERS = ['\n', ':', '"', '*']

/** DRY's own defaults, which are the values the sampler was tuned around. */
const DRY_BASE = 1.75
const DRY_ALLOWED_LENGTH = 2

/**
 * Repetition is the most visible failure of small local models in long roleplay, and
 * prompt text alone does not fix it. Characters get anti-repetition sampling plus a
 * stop sequence on the user's name, which is what stops the model writing their turn.
 *
 * The anti-repetition work is done by DRY, not by the token penalties. `repeat_penalty`,
 * `presence_penalty` and `frequency_penalty` all push down *individual* tokens, and over
 * a few hundred tokens of narrated prose the tokens that recur are "the", "she", and the
 * character's own name — so they buy a little less phrase repetition at the cost of the
 * prose drifting into odd, slightly-wrong word choices. DRY penalises a repeated
 * *sequence* instead, which is the thing that actually reads as repetition, and leaves
 * ordinary words alone. XTC then drops the single most likely continuation part of the
 * time, which is where stock phrasing comes from.
 *
 * llama-server's default sampler order is already
 * `penalties;dry;top_n_sigma;top_k;typ_p;top_p;min_p;xtc;temperature`, so no explicit
 * chain is sent: DRY runs before the truncation and XTC after it either way. The
 * samplers we do not want are disabled by value rather than by reordering.
 */
/**
 * Every reply asking for the same number of tokens is what makes a conversation read as
 * a machine, more than any individual word choice does. Keyed off the turn index rather
 * than randomised so a regenerate is reproducible.
 */
const LENGTH_VARIANCE = [0.55, 0.8, 1.0, 1.0, 1.3]

export function resolveGenerationParams(
  c: Character | null,
  settings: AppSettings | null,
  userName?: string | null,
  others?: Character[] | null,
  turnIndex = 0,
): GenerationParams {
  const inCharacter = Boolean(c && !isOverrideMode(c))
  const names = speakerName(c, userName)

  // A scene carries its action as well as its dialogue, so the same "length" needs
  // more room than a chat line does.
  const narrationRoom = c?.narration_style === 'story' ? 1.6 : 1
  const variance = inCharacter
    ? LENGTH_VARIANCE[Math.abs(turnIndex) % LENGTH_VARIANCE.length]
    : 1
  const derivedMax = c
    ? Math.max(
        64,
        Math.round(LENGTH_MAX_TOKENS[c.response_length] * narrationRoom * variance),
      )
    : undefined
  const ceiling = settings?.max_tokens ?? 2048
  const max_tokens = c?.max_tokens ?? Math.min(ceiling, derivedMax ?? ceiling)

  // Matches how turns are labelled in history, so the model stops where it would
  // otherwise start writing somebody else's reply for them.
  //
  // The character's own name is in here too, and in a solo chat it is the one that
  // actually fires: solo history carries no `Name:` prefixes, so a stop on the user's
  // label matches a pattern the model has never seen. A model that starts labelling its
  // own line is the common runaway, and this cuts it at the source rather than leaving
  // `stripOwnName` to clean up after it.
  const speakers = [
    names.label,
    ...(c ? [c.name] : []),
    ...(others ?? []).map((o) => o.name),
  ]
  const stop = inCharacter ? [...new Set(speakers)].map((n) => `\n${n}:`) : []

  if (!inCharacter) {
    return {
      temperature: c?.temperature ?? settings?.temperature ?? 0.7,
      top_p: c?.top_p ?? settings?.top_p ?? 0.9,
      max_tokens,
      repeat_penalty: 1.0,
      repeat_last_n: 64,
      presence_penalty: 0,
      frequency_penalty: 0,
      min_p: 0,
      top_k: 40,
      stop,
      dry_multiplier: 0,
      dry_base: DRY_BASE,
      dry_allowed_length: DRY_ALLOWED_LENGTH,
      dry_penalty_last_n: -1,
      dry_sequence_breakers: [],
      xtc_probability: 0,
      xtc_threshold: 0.1,
    }
  }

  return {
    temperature: c?.temperature ?? settings?.temperature ?? 0.7,
    // min_p is the only truncation left on. Stacking top_p and top_k on top of it cuts
    // the tail twice and is what makes a character sound like they have three moods.
    top_p: c?.top_p ?? 1.0,
    max_tokens,
    repeat_penalty: 1.0,
    repeat_last_n: 0,
    presence_penalty: 0,
    frequency_penalty: 0,
    min_p: 0.05,
    top_k: 0,
    stop,
    dry_multiplier: settings?.dry_multiplier ?? 0.8,
    dry_base: DRY_BASE,
    dry_allowed_length: DRY_ALLOWED_LENGTH,
    // -1 is the whole context: a phrase reused twenty turns back still reads as reused.
    dry_penalty_last_n: -1,
    dry_sequence_breakers: DRY_SEQUENCE_BREAKERS,
    // Off unless asked for. XTC drops the most likely token, and the first thing a
    // Llama-2-era merge drops with it is the quotes-and-asterisks convention.
    xtc_probability: settings?.xtc_probability ?? 0,
    xtc_threshold: settings?.xtc_threshold ?? 0.1,
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
