import { create } from 'zustand'
import type { ConversationSummary, Memory, MemoryKind } from '@/types'
import * as db from '@/services/database'
import { keywordString } from '@/services/memory'

/**
 * What the character remembers, and the user's handle on it. Pinned entries are always
 * injected, never decay and are never evicted — the steering wheel for a character
 * that has picked something up wrong.
 */
interface MemoryState {
  memories: Memory[]
  summary: ConversationSummary | null
  loadingFor: string | null
  load: (characterId: string, conversationId?: string | null) => Promise<void>
  add: (characterId: string, content: string) => Promise<void>
  edit: (id: string, content: string) => Promise<void>
  setKind: (id: string, kind: MemoryKind) => Promise<void>
  togglePin: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  forgetAll: (characterId: string) => Promise<void>
  clearSummary: (conversationId: string) => Promise<void>
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],
  summary: null,
  loadingFor: null,

  load: async (characterId, conversationId) => {
    set({ loadingFor: characterId })
    const [memories, summary] = await Promise.all([
      db.listMemories(characterId),
      conversationId
        ? db.getConversationSummary(conversationId)
        : Promise.resolve(null),
    ])
    set({ memories, summary, loadingFor: null })
  },

  add: async (characterId, content) => {
    const text = content.trim()
    if (!text) return
    const created = await db.createMemory({
      character_id: characterId,
      kind: 'pinned',
      content: text,
      keywords: keywordString(text),
      importance: 1,
      pinned: true,
    })
    set({ memories: [created, ...get().memories] })
  },

  edit: async (id, content) => {
    const text = content.trim()
    if (!text) return
    await db.updateMemory({ id, content: text, keywords: keywordString(text) })
    set({
      memories: get().memories.map((m) =>
        m.id === id ? { ...m, content: text, keywords: keywordString(text) } : m,
      ),
    })
  },

  setKind: async (id, kind) => {
    await db.updateMemory({ id, kind })
    set({
      memories: get().memories.map((m) => (m.id === id ? { ...m, kind } : m)),
    })
  },

  togglePin: async (id) => {
    const memory = get().memories.find((m) => m.id === id)
    if (!memory) return
    const pinned = !memory.pinned
    await db.updateMemory({ id, pinned, importance: pinned ? 1 : memory.importance })
    set({
      memories: get().memories.map((m) => (m.id === id ? { ...m, pinned } : m)),
    })
  },

  remove: async (id) => {
    await db.deleteMemory(id)
    set({ memories: get().memories.filter((m) => m.id !== id) })
  },

  forgetAll: async (characterId) => {
    await db.deleteMemoriesForCharacter(characterId)
    set({ memories: [] })
  },

  clearSummary: async (conversationId) => {
    await db.clearConversationSummary(conversationId)
    set({ summary: null })
  },
}))
