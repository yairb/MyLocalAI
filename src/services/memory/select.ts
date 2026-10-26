import type { Memory, MemoryKind, Message } from '@/types'
import { extractKeywords, jaccard } from './keywords'
import { effectiveImportance } from './facts'

/**
 * Picks which long-term facts to put in front of the model this turn, without
 * embeddings: keyword overlap with the recent turns, decayed importance, recency, and
 * a prior on the kind of fact.
 */

const KIND_PRIOR: Record<MemoryKind, number> = {
  identity: 1,
  promise: 1,
  relationship: 0.8,
  preference: 0.7,
  emotion: 0.6,
  event: 0.5,
  fact: 0.5,
  pinned: 1,
}

const RECENT_TURNS = 6
const HALF_LIFE_DAYS = 14

function recency(memory: Memory, now: number): number {
  const days = Math.max(0, (now - new Date(memory.updated_at).getTime()) / 86_400_000)
  return 0.5 ** (days / HALF_LIFE_DAYS)
}

export interface SelectMemoriesInput {
  memories: Memory[]
  recentMessages: Message[]
  /** Rough character budget for the rendered fact list. */
  budgetChars: number
}

export function selectMemories(input: SelectMemoriesInput): Memory[] {
  const now = Date.now()
  const recentText = input.recentMessages
    .slice(-RECENT_TURNS)
    .map((m) => m.content)
    .join(' ')
  const recentKeywords = extractKeywords(recentText, 40)

  const pinned = input.memories.filter((m) => m.pinned)
  const rest = input.memories.filter((m) => !m.pinned)

  // Identity facts bypass topical scoring: without this the character "forgets your
  // name" the moment the conversation moves on to something else.
  const identity = rest
    .filter((m) => m.kind === 'identity')
    .sort((a, b) => effectiveImportance(b, now) - effectiveImportance(a, now))
    .slice(0, 3)

  const identityIds = new Set(identity.map((m) => m.id))
  const scored = rest
    .filter((m) => !identityIds.has(m.id))
    .map((memory) => ({
      memory,
      score:
        0.45 * jaccard(recentKeywords, memory.keywords.split(' ').filter(Boolean)) +
        0.25 * effectiveImportance(memory, now) +
        0.15 * recency(memory, now) +
        0.15 * (KIND_PRIOR[memory.kind] ?? 0.5),
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.memory)

  const ordered = [...pinned, ...identity, ...scored]
  const selected: Memory[] = []
  let used = 0

  for (const memory of ordered) {
    const cost = memory.content.length + 3
    if (selected.length && used + cost > input.budgetChars) break
    selected.push(memory)
    used += cost
  }

  return selected
}
