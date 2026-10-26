import type { Character } from '@/types'
import { useChatStore } from '@/stores/chatStore'
import { useCharacterStore } from '@/stores/characterStore'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * The character for the conversation on screen.
 *
 * Replaces the `characters.find(c => c.id === activeCharacterId) ?? characters[0]`
 * expression that was duplicated across the chat area, the sidebar and the empty
 * state — and makes `conversation.character_id` the thing that actually decides.
 */
export function useConversationCharacter(): Character | null {
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const conversations = useChatStore((s) => s.conversations)
  const characters = useCharacterStore((s) => s.characters)
  const activeCharacterId = useSettingsStore((s) => s.settings?.active_character_id)

  const conversation = conversations.find((c) => c.id === activeConversationId)
  const byConversation = conversation?.character_id
    ? characters.find((c) => c.id === conversation.character_id)
    : undefined

  return (
    byConversation ??
    characters.find((c) => c.id === activeCharacterId) ??
    characters[0] ??
    null
  )
}
