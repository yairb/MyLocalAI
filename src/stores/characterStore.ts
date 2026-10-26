import { create } from 'zustand'
import type {
  Character,
  Conversation,
  CreateCharacterInput,
  UpdateCharacterInput,
} from '@/types'
import * as db from '@/services/database'
import { useSettingsStore } from './settingsStore'

interface CharacterState {
  characters: Character[]
  loading: boolean
  load: () => Promise<void>
  create: (input: CreateCharacterInput) => Promise<Character>
  update: (input: UpdateCharacterInput) => Promise<void>
  remove: (id: string) => Promise<void>
  setActive: (id: string) => Promise<void>
  getActive: () => Character | null
  getById: (id: string | null | undefined) => Character | null
  /** The character this conversation belongs to, falling back to the active one. */
  getForConversation: (conversation: Conversation | null | undefined) => Character | null
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
  characters: [],
  loading: true,

  load: async () => {
    set({ loading: true })
    try {
      const characters = await db.listCharacters()
      set({ characters, loading: false })
    } catch (e) {
      console.error(e)
      set({ loading: false })
    }
  },

  create: async (input) => {
    const character = await db.createCharacter(input)
    set({ characters: [...get().characters, character] })
    return character
  },

  update: async (input) => {
    const updated = await db.updateCharacter(input)
    set({
      characters: get().characters.map((c) =>
        c.id === updated.id ? updated : c,
      ),
    })
  },

  remove: async (id) => {
    await db.deleteCharacter(id)
    set({ characters: get().characters.filter((c) => c.id !== id) })
  },

  setActive: async (id) => {
    await useSettingsStore.getState().update({ active_character_id: id })
  },

  getActive: () => {
    const activeId = useSettingsStore.getState().settings?.active_character_id
    const { characters } = get()
    if (!activeId) return characters[0] ?? null
    return characters.find((c) => c.id === activeId) ?? characters[0] ?? null
  },

  getById: (id) => {
    if (!id) return null
    return get().characters.find((c) => c.id === id) ?? null
  },

  // Conversations have carried a character_id since before this feature; this is
  // what finally makes it authoritative. The fallback covers conversations created
  // earlier and ones whose character has since been deleted.
  getForConversation: (conversation) =>
    get().getById(conversation?.character_id) ?? get().getActive(),
}))
