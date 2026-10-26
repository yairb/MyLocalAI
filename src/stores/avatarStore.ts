import { create } from 'zustand'
import type { Character } from '@/types'
import * as db from '@/services/database'
import { runImageGeneration } from '@/services/imagePipeline'
import { useChatStore } from './chatStore'
import { useCharacterStore } from './characterStore'
import { useSettingsStore } from './settingsStore'

/**
 * Generates a character's profile picture.
 *
 * Writes no chat message and no generated_images row: the avatar belongs to the
 * character, not to a conversation. The resolved seed is stored back on the character,
 * which is what makes later in-chat photos show the same face.
 */
interface AvatarState {
  generatingFor: string | null
  progress: number
  error: string | null
  generate: (character: Character, opts?: { reroll?: boolean }) => Promise<void>
  cancel: () => void
  clearError: () => void
}

let controller: AbortController | null = null

export const useAvatarStore = create<AvatarState>((set, get) => ({
  generatingFor: null,
  progress: 0,
  error: null,

  generate: async (character, opts) => {
    if (get().generatingFor) return

    // ImageGenManager is a process-wide singleton that rejects a second job with a
    // bare error string; guard in both directions so neither side sees it.
    if (useChatStore.getState().turnPhase !== 'idle') {
      set({ error: 'Wait for the current message to finish, then try again.' })
      return
    }

    const settings = useSettingsStore.getState().settings
    if (!settings?.image_model_path) {
      set({ error: 'No image model configured — set one in Settings.' })
      return
    }
    if (!character.appearance_prompt.trim()) {
      set({ error: 'Describe how this character looks first.' })
      return
    }

    const previousAvatar = character.avatar_path
    const variant = character.avatar_variant + 1
    controller = new AbortController()
    set({ generatingFor: character.id, progress: 0, error: null })

    try {
      const { result } = await runImageGeneration(
        {
          conversationId: null,
          kind: 'avatar',
          originalPrompt: character.appearance_prompt,
          // A re-roll asks for a new identity; otherwise reuse the locked seed.
          character: opts?.reroll
            ? { ...character, appearance_seed: null }
            : character,
          portrait: true,
          persist: false,
          resolution: settings.avatar_resolution,
        },
        {
          signal: controller.signal,
          onProgress: (event) => set({ progress: event.progress }),
        },
      )

      const avatarPath = await db.saveCharacterAvatar(
        result.image_path,
        character.id,
        variant,
      )

      await useCharacterStore.getState().update({
        id: character.id,
        avatar_path: avatarPath,
        appearance_seed: result.seed,
        avatar_variant: variant,
      })

      if (previousAvatar && previousAvatar !== avatarPath) {
        await db.deleteCharacterAvatar(previousAvatar)
      }

      set({ generatingFor: null, progress: 100 })
    } catch (e) {
      const aborted = controller?.signal.aborted
      set({
        generatingFor: null,
        progress: 0,
        error: aborted
          ? null
          : e instanceof Error
            ? e.message
            : 'Could not generate the avatar.',
      })
    } finally {
      controller = null
    }
  },

  cancel: () => {
    controller?.abort()
    set({ generatingFor: null, progress: 0 })
  },

  clearError: () => set({ error: null }),
}))
