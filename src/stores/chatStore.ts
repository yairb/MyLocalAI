import { create } from 'zustand'
import type { Conversation, Message } from '@/types'
import * as db from '@/services/database'
import {
  buildBaseUrl,
  streamChatCompletion,
} from '@/services/llamaClient'
import { generateTitle } from '@/utils/title'
import { createId } from '@/utils/id'
import { useCharacterStore } from './characterStore'
import { useSettingsStore } from './settingsStore'

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  messages: Message[]
  searchQuery: string
  isGenerating: boolean
  streamingContent: string
  error: string | null
  abortController: AbortController | null
  inputFocusToken: number

  loadConversations: () => Promise<void>
  setSearchQuery: (q: string) => void
  selectConversation: (id: string | null) => Promise<void>
  newChat: () => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  sendMessage: (content: string) => Promise<void>
  stopGenerating: () => void
  clearError: () => void
  requestInputFocus: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  searchQuery: '',
  isGenerating: false,
  streamingContent: '',
  error: null,
  abortController: null,
  inputFocusToken: 0,

  loadConversations: async () => {
    const conversations = await db.listConversations()
    set({ conversations })
  },

  setSearchQuery: (q) => set({ searchQuery: q }),

  selectConversation: async (id) => {
    if (get().isGenerating) get().stopGenerating()
    if (!id) {
      set({ activeConversationId: null, messages: [] })
      return
    }
    const messages = await db.listMessages(id)
    set({ activeConversationId: id, messages, error: null })
  },

  newChat: async () => {
    if (get().isGenerating) get().stopGenerating()
    const character = useCharacterStore.getState().getActive()
    const conv = await db.createConversation('New Chat', character?.id ?? null)
    const conversations = await db.listConversations()
    set({
      conversations,
      activeConversationId: conv.id,
      messages: [],
      error: null,
      inputFocusToken: get().inputFocusToken + 1,
    })
  },

  renameConversation: async (id, title) => {
    await db.updateConversation(id, { title })
    const conversations = await db.listConversations()
    set({ conversations })
  },

  deleteConversation: async (id) => {
    await db.deleteConversation(id)
    const conversations = await db.listConversations()
    const { activeConversationId } = get()
    if (activeConversationId === id) {
      set({
        conversations,
        activeConversationId: null,
        messages: [],
      })
    } else {
      set({ conversations })
    }
  },

  sendMessage: async (content) => {
    const trimmed = content.trim()
    if (!trimmed || get().isGenerating) return

    const settings = useSettingsStore.getState().settings
    const character = useCharacterStore.getState().getActive()

    let conversationId = get().activeConversationId
    let isFirstMessage = false

    if (!conversationId) {
      const conv = await db.createConversation(
        generateTitle(trimmed),
        character?.id ?? null,
      )
      conversationId = conv.id
      isFirstMessage = true
      set({ activeConversationId: conversationId })
    } else {
      const existing = get().messages
      isFirstMessage = existing.filter((m) => m.role === 'user').length === 0
    }

    const userMsg = await db.addMessage(conversationId, 'user', trimmed)

    if (isFirstMessage) {
      await db.updateConversation(conversationId, {
        title: generateTitle(trimmed),
      })
    }

    const conversations = await db.listConversations()
    const messages = [...get().messages, userMsg]
    set({
      messages,
      conversations,
      isGenerating: true,
      streamingContent: '',
      error: null,
    })

    const assistantId = createId()
    const abortController = new AbortController()
    set({ abortController })

    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }))

    const chatMessages = [
      {
        role: 'system' as const,
        content:
          character?.system_prompt ??
          'You are a helpful AI assistant running locally.',
      },
      // Future: inject relevant long-term memories here
      ...history,
    ]

    const temperature =
      character?.temperature ?? settings?.temperature ?? 0.7
    const baseUrl = buildBaseUrl(
      settings?.llama_host ?? '127.0.0.1',
      settings?.llama_port ?? 8080,
    )

    let full = ''

    try {
      await streamChatCompletion({
        baseUrl,
        messages: chatMessages,
        temperature,
        top_p: settings?.top_p ?? 0.9,
        max_tokens: settings?.max_tokens ?? 2048,
        signal: abortController.signal,
        onToken: (token) => {
          full += token
          set({ streamingContent: full })
        },
      })

      const saved = await db.addMessage(conversationId, 'assistant', full || '…')
      // Replace optimistic id if needed
      void assistantId
      const nextMessages = await db.listMessages(conversationId)
      const nextConversations = await db.listConversations()
      set({
        messages: nextMessages.length ? nextMessages : [...messages, saved],
        conversations: nextConversations,
        isGenerating: false,
        streamingContent: '',
        abortController: null,
      })
    } catch (e) {
      if (abortController.signal.aborted) {
        if (full) {
          await db.addMessage(conversationId, 'assistant', full)
          const nextMessages = await db.listMessages(conversationId)
          set({
            messages: nextMessages,
            isGenerating: false,
            streamingContent: '',
            abortController: null,
          })
        } else {
          set({
            isGenerating: false,
            streamingContent: '',
            abortController: null,
          })
        }
        return
      }

      const message =
        e instanceof Error
          ? e.message
          : 'Failed to get a response from the local model'
      set({
        isGenerating: false,
        streamingContent: '',
        abortController: null,
        error: message,
      })
    }
  },

  stopGenerating: () => {
    get().abortController?.abort()
    set({ abortController: null, isGenerating: false })
  },

  clearError: () => set({ error: null }),

  requestInputFocus: () =>
    set({ inputFocusToken: get().inputFocusToken + 1 }),
}))
