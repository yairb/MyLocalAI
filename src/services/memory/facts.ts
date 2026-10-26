import type { Character, Memory, MemoryKind, Message } from '@/types'
import * as db from '@/services/database'
import { completeChat } from '@/services/llamaClient'
import {
  diceSimilarity,
  extractKeywords,
  jaccard,
  keywordString,
  normalizeFact,
} from './keywords'

const EXTRACTION_SYSTEM = `Extract durable facts from the conversation below. These will be remembered for months.

Return a JSON array. Each item: {"kind": "...", "content": "...", "importance": 0.0-1.0}
kind is one of: identity, preference, relationship, event, promise, emotion.

Keep only what would still matter in a month:
identity     - name, age, job, where they live, health, languages
preference   - likes, dislikes, boundaries, how they want to be spoken to
relationship - people and pets in their life, and who those people are to them
event        - things that happened to them, and things the two of you did together
promise      - something either of you said you would do
emotion      - a lasting feeling or a sore subject, not a passing mood

Drop: small talk, the weather, anything already covered by an earlier fact, anything the character said about itself, speculation, and anything the user only asked about rather than stated.
Write each fact as one short third-person sentence that stands on its own without context.
Use the user's words for names and nouns. Never invent.
If there is nothing worth keeping, return [].
Output only the JSON array.`

const VALID_KINDS: MemoryKind[] = [
  'identity',
  'preference',
  'relationship',
  'event',
  'promise',
  'emotion',
]

const MAX_FACTS_PER_RUN = 8
const MAX_FACT_CHARS = 200

interface ExtractedFact {
  kind: MemoryKind
  content: string
  importance: number
}

/**
 * Small models produce near-JSON often enough that strict parsing throws away good
 * output. Slice to the outermost brackets and drop whatever doesn't fit the shape.
 */
function parseFacts(raw: string): ExtractedFact[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out: ExtractedFact[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const content = typeof record.content === 'string' ? normalizeFact(record.content) : ''
    if (!content || content.length > MAX_FACT_CHARS) continue

    const kind = VALID_KINDS.includes(record.kind as MemoryKind)
      ? (record.kind as MemoryKind)
      : 'fact'
    const rawImportance = Number(record.importance)
    const importance = Number.isFinite(rawImportance)
      ? Math.min(1, Math.max(0, rawImportance))
      : 0.5

    out.push({ kind, content, importance })
    if (out.length >= MAX_FACTS_PER_RUN) break
  }
  return out
}

function transcript(messages: Message[], character: Character, userName: string): string {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? userName : character.name}: ${m.content}`)
    .join('\n')
}

export interface ExtractFactsOptions {
  baseUrl: string
  signal?: AbortSignal
  userName: string
  conversationId: string
}

/**
 * Pulls durable facts out of a window of turns and merges them into the character's
 * long-term store. Returns how many rows were newly written or updated.
 */
export async function extractFacts(
  character: Character,
  messages: Message[],
  options: ExtractFactsOptions,
): Promise<number> {
  const text = transcript(messages, character, options.userName)
  if (text.trim().length < 80) return 0

  const raw = await completeChat({
    baseUrl: options.baseUrl,
    temperature: 0.1,
    top_p: 0.9,
    max_tokens: 400,
    signal: options.signal,
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM },
      { role: 'user', content: text },
    ],
  })

  const candidates = parseFacts(raw)
  if (!candidates.length) return 0

  // Anything that is really just the persona restated is not a fact about the user.
  const personaKeywords = new Set(
    extractKeywords(
      [
        character.backstory,
        character.personality_traits.join(' '),
        character.appearance_prompt,
        character.scenario,
      ].join(' '),
      60,
    ),
  )

  const existing = await db.listMemories(character.id)
  let written = 0

  for (const candidate of candidates) {
    const keywords = extractKeywords(candidate.content)
    if (
      keywords.length > 0 &&
      keywords.every((k) => personaKeywords.has(k))
    ) {
      continue
    }

    const merged = await mergeFact(candidate, keywords, existing, character.id, options)
    if (merged) written += 1
  }

  if (written) await enforceCap(character.id)
  return written
}

async function mergeFact(
  candidate: ExtractedFact,
  keywords: string[],
  existing: Memory[],
  characterId: string,
  options: ExtractFactsOptions,
): Promise<boolean> {
  const sameKind = existing.filter((m) => m.kind === candidate.kind)

  const exact = sameKind.find((m) => normalizeFact(m.content) === candidate.content)
  if (exact) {
    await db.updateMemory({
      id: exact.id,
      importance: Math.max(exact.importance, candidate.importance),
    })
    return false
  }

  // Jobs, feelings and living situations change: a near-duplicate is an update, and
  // the newer wording wins. Repeated mentions nudge importance up.
  const near = sameKind.find(
    (m) =>
      jaccard(keywords, m.keywords.split(' ').filter(Boolean)) >= 0.6 ||
      diceSimilarity(m.content, candidate.content) >= 0.75,
  )
  if (near) {
    await db.updateMemory({
      id: near.id,
      content: candidate.content,
      keywords: keywords.join(' '),
      importance: Math.min(1, Math.max(near.importance, candidate.importance) + 0.05),
    })
    Object.assign(near, { content: candidate.content, keywords: keywords.join(' ') })
    return true
  }

  // Two identity facts about the same subject contradict rather than coexist.
  if (candidate.kind === 'identity') {
    const contradiction = sameKind.find((m) => {
      const shared = keywords.filter((k) => m.keywords.includes(k))
      return shared.length >= 2
    })
    if (contradiction) {
      await db.updateMemory({
        id: contradiction.id,
        content: candidate.content,
        keywords: keywords.join(' '),
        importance: Math.max(contradiction.importance, candidate.importance),
      })
      Object.assign(contradiction, {
        content: candidate.content,
        keywords: keywords.join(' '),
      })
      return true
    }
  }

  const created = await db.createMemory({
    character_id: characterId,
    conversation_id: options.conversationId,
    kind: candidate.kind,
    content: candidate.content,
    keywords: keywords.join(' '),
    importance: candidate.importance,
  })
  existing.push(created)
  return true
}

/**
 * Importance decayed by age, lifted slightly by how often the fact has actually been
 * recalled. Computed at read time because the app has no background scheduler.
 */
export function effectiveImportance(memory: Memory, now = Date.now()): number {
  if (memory.pinned) return 1
  const days = Math.max(
    0,
    (now - new Date(memory.updated_at).getTime()) / 86_400_000,
  )
  const decayed = memory.importance * 0.985 ** days
  const recallBonus = 0.1 * (Math.min(memory.hits, 5) / 5)
  return Math.min(1, decayed + recallBonus)
}

async function enforceCap(characterId: string): Promise<void> {
  const settings = await db.getSettings()
  const cap = settings.memory_max_facts ?? 200
  const all = await db.listMemories(characterId)
  if (all.length <= cap) return

  const now = Date.now()
  const evictable = all
    .filter((m) => !m.pinned)
    .sort((a, b) => effectiveImportance(a, now) - effectiveImportance(b, now))

  const promiseCount = all.filter((m) => m.kind === 'promise').length
  let toRemove = all.length - cap

  for (const memory of evictable) {
    if (toRemove <= 0) break
    // Promises are what the character is held to; never thin them out early.
    if (memory.kind === 'promise' && all.length - promiseCount < 50) continue
    await db.deleteMemory(memory.id)
    toRemove -= 1
  }
}

export { keywordString }
