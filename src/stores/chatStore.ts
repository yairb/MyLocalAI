import { create } from 'zustand'
import type {
  Character,
  ChatCompletionMessage,
  Conversation,
  ImageGenerationJob,
  Message,
} from '@/types'
import * as db from '@/services/database'
import { buildBaseUrl, streamChatCompletion } from '@/services/llamaClient'
import {
  getImageGenerationProvider,
  revealImageInFinder,
  saveImageAs,
} from '@/services/imageGeneration'
import { runImageGeneration } from '@/services/imagePipeline'
import {
  buildSystemPrompt,
  resolveGenerationParams,
} from '@/services/personaPrompt'
import {
  createEstimator,
  packContext,
} from '@/services/contextBudget'
import {
  IMAGE_REQUEST_NUDGE,
  PHOTO_INSTRUCTIONS,
  createSentinelFilter,
  looksLikeImageRequest,
} from '@/services/imageDirector'
import {
  cancelBackgroundWork,
  scheduleMemoryWork,
  selectMemories,
} from '@/services/memory'
import { generateTitle } from '@/utils/title'
import { createId } from '@/utils/id'
import { useCharacterStore } from './characterStore'
import { useEngineStore } from './engineStore'
import { useSettingsStore } from './settingsStore'

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  if (error && typeof error === 'object') {
    const candidate = (error as { message?: unknown; error?: unknown }).message
      ?? (error as { error?: unknown }).error
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate
    }
    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') {
        return serialized
      }
    } catch {
      // Ignore JSON stringify failures and return fallback.
    }
  }
  return fallback
}

/**
 * One turn, start to finish. A turn that ends in a photo costs a full model reload,
 * so the phases are visible to the UI rather than hidden behind two booleans.
 */
export type TurnPhase =
  | 'idle'
  | 'streaming'
  | 'composing_image'
  | 'engine_pausing'
  | 'generating_image'
  | 'engine_resuming'

/** How a message is shown to the model, as opposed to to the user. */
function renderForModel(message: Message): ChatCompletionMessage | null {
  if (message.role === 'user') {
    return { role: 'user', content: message.content }
  }
  if (message.role !== 'assistant') {
    // Standalone tool images stay out of history, as before.
    return null
  }
  // Closes the continuity hole: without this the character has no idea it just sent
  // a photo, and the next turn reads as though nothing happened.
  const caption = message.image?.caption
  return {
    role: 'assistant',
    content: caption
      ? `${message.content}\n[you sent a photo: ${caption}]`
      : message.content,
  }
}

function countTurnsSinceLastSelfie(messages: Message[]): number {
  let turns = 0
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    if (m.image?.kind === 'character_selfie') return turns
    turns += 1
  }
  return Number.POSITIVE_INFINITY
}

/** Persists the character's opening line so it is part of history, not just UI. */
async function ensureGreeting(
  conversationId: string,
  character: Character | null,
): Promise<Message[]> {
  const greeting = character?.greeting?.trim()
  if (!greeting) return []
  const existing = await db.listMessages(conversationId)
  if (existing.length > 0) return existing
  const message = await db.addMessage(conversationId, 'assistant', greeting)
  return [message]
}

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  messages: Message[]
  searchQuery: string
  isGenerating: boolean
  streamingContent: string
  error: string | null
  abortController: AbortController | null
  imageAbortController: AbortController | null
  inputFocusToken: number

  /** The whole turn, including the photo tail. */
  turnPhase: TurnPhase
  /** Typed while the engine was down; sent automatically once the turn finishes. */
  queuedMessage: string | null

  /** Image generation (independent of text chat streaming) */
  isGeneratingImage: boolean
  imageJob: ImageGenerationJob | null
  imageMode: boolean
  enhancePrompt: boolean

  loadConversations: () => Promise<void>
  setSearchQuery: (q: string) => void
  selectConversation: (id: string | null) => Promise<void>
  newChat: (characterId?: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  setConversationCharacter: (conversationId: string, characterId: string) => Promise<void>
  sendMessage: (content: string) => Promise<void>
  stopGenerating: () => void
  clearError: () => void
  requestInputFocus: () => void

  setImageMode: (enabled: boolean) => void
  setEnhancePrompt: (enabled: boolean) => void
  generateImage: (prompt: string) => Promise<void>
  regenerateImage: (messageId: string) => Promise<void>
  deleteImageMessage: (messageId: string) => Promise<void>
  downloadImage: (imagePath: string) => Promise<void>
  openImageInFinder: (imagePath: string) => Promise<void>
  cancelImageGeneration: () => void
  retryImageGeneration: () => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => {
  /** Keeps the legacy booleans in step with the phase so the UI can migrate gradually. */
  const setPhase = (turnPhase: TurnPhase) => {
    set({
      turnPhase,
      isGenerating: turnPhase === 'streaming',
      isGeneratingImage:
        turnPhase === 'composing_image' ||
        turnPhase === 'engine_pausing' ||
        turnPhase === 'generating_image' ||
        turnPhase === 'engine_resuming',
    })
  }

  const resolveCharacter = (conversationId: string | null): Character | null => {
    const characters = useCharacterStore.getState()
    const conversation = get().conversations.find((c) => c.id === conversationId)
    return characters.getForConversation(conversation ?? null)
  }

  const refreshAfterTurn = async (conversationId: string) => {
    const [messages, conversations] = await Promise.all([
      db.listMessages(conversationId),
      db.listConversations(),
    ])
    set({ messages, conversations })
    return messages
  }

  /** Runs the queued message once the engine is back, so nothing is silently dropped. */
  const flushQueued = () => {
    const queued = get().queuedMessage
    if (!queued) return
    set({ queuedMessage: null })
    void get().sendMessage(queued)
  }

  return {
    conversations: [],
    activeConversationId: null,
    messages: [],
    searchQuery: '',
    isGenerating: false,
    streamingContent: '',
    error: null,
    abortController: null,
    imageAbortController: null,
    inputFocusToken: 0,

    turnPhase: 'idle',
    queuedMessage: null,

    isGeneratingImage: false,
    imageJob: null,
    imageMode: false,
    enhancePrompt: true,

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

    newChat: async (characterId) => {
      if (get().isGenerating) get().stopGenerating()
      const characters = useCharacterStore.getState()
      const character =
        (characterId ? characters.getById(characterId) : null) ?? characters.getActive()
      const conv = await db.createConversation('New Chat', character?.id ?? null)
      const messages = await ensureGreeting(conv.id, character)
      const conversations = await db.listConversations()
      set({
        conversations,
        activeConversationId: conv.id,
        messages,
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

    setConversationCharacter: async (conversationId, characterId) => {
      await db.updateConversation(conversationId, { character_id: characterId })
      const conversations = await db.listConversations()
      set({ conversations })
    },

    setImageMode: (enabled) => set({ imageMode: enabled }),

    setEnhancePrompt: (enabled) => {
      set({ enhancePrompt: enabled })
      void useSettingsStore.getState().update({ image_enhance_prompt: enabled })
    },

    sendMessage: async (content) => {
      const trimmed = content.trim()
      if (!trimmed) return

      // Standalone image tool: unrelated to characters.
      if (get().imageMode) {
        await get().generateImage(trimmed)
        return
      }

      // Mid-turn the engine may be stopped for a photo. Queue rather than firing at a
      // dead port or blocking the composer outright.
      if (get().turnPhase !== 'idle') {
        set({ queuedMessage: trimmed })
        return
      }

      cancelBackgroundWork()

      const settings = useSettingsStore.getState().settings
      let conversationId = get().activeConversationId
      let character = resolveCharacter(conversationId)
      let isFirstMessage = false

      if (!conversationId) {
        const conv = await db.createConversation(
          generateTitle(trimmed),
          character?.id ?? null,
        )
        conversationId = conv.id
        isFirstMessage = true
        set({
          activeConversationId: conversationId,
          conversations: await db.listConversations(),
        })
        character = resolveCharacter(conversationId)
        const greeted = await ensureGreeting(conversationId, character)
        if (greeted.length) set({ messages: greeted })
      } else {
        isFirstMessage = get().messages.filter((m) => m.role === 'user').length === 0
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
        streamingContent: '',
        error: null,
      })
      setPhase('streaming')

      const abortController = new AbortController()
      set({ abortController })

      const userName = settings?.user_name?.trim() || 'the user'
      const photosAvailable = Boolean(
        character?.can_send_images &&
          settings?.auto_image_enabled &&
          settings?.image_model_path,
      )

      // ── Assemble what the model sees ────────────────────────────
      const [summaryRow, allMemories] = await Promise.all([
        db.getConversationSummary(conversationId),
        character?.memory_enabled && settings?.memory_enabled
          ? db.listMemories(character.id)
          : Promise.resolve([]),
      ])

      const facts = allMemories.length
        ? selectMemories({
            memories: allMemories,
            recentMessages: messages,
            budgetChars: 1200,
          })
        : []

      const persona = buildSystemPrompt({
        character,
        userName: settings?.user_name,
        userPersona: settings?.user_persona,
        memory: { summary: summaryRow?.summary ?? null, facts },
        image: {
          enabled: photosAvailable,
          directive: photosAvailable
            ? PHOTO_INSTRUCTIONS(character?.name ?? 'you', userName)
            : null,
        },
      })

      const engine = useEngineStore.getState()
      const contextWindow = engine.contextWindow ?? settings?.context_size ?? 4096
      const params = resolveGenerationParams(character, settings ?? null, settings?.user_name)

      const packed = packContext({
        contextWindow,
        maxTokens: params.max_tokens,
        persona,
        messages,
        estimator: createEstimator(engine.charsPerToken ?? undefined),
        renderMessage: renderForModel,
      })

      // Small models often say "sure, here you go!" without emitting the tag. A
      // throwaway nudge is far more reliable than hoping the standing rule sticks.
      const chatMessages = [...packed.chatMessages]
      if (photosAvailable && looksLikeImageRequest(trimmed)) {
        chatMessages.splice(chatMessages.length - 1, 0, {
          role: 'system',
          content: IMAGE_REQUEST_NUDGE(userName),
        })
      }

      const baseUrl = buildBaseUrl(
        settings?.llama_host ?? '127.0.0.1',
        settings?.llama_port ?? 8080,
      )

      const filter = createSentinelFilter()
      let rawReply = ''

      try {
        await streamChatCompletion({
          baseUrl,
          messages: chatMessages,
          temperature: params.temperature,
          top_p: params.top_p,
          max_tokens: Math.min(params.max_tokens, packed.replyReservation),
          repeat_penalty: params.repeat_penalty,
          repeat_last_n: params.repeat_last_n,
          presence_penalty: params.presence_penalty,
          frequency_penalty: params.frequency_penalty,
          min_p: params.min_p,
          top_k: params.top_k,
          stop: params.stop,
          signal: abortController.signal,
          onToken: (token) => {
            rawReply += token
            set({ streamingContent: filter.push(token) })
          },
        })
      } catch (e) {
        const aborted = abortController.signal.aborted
        const partial = filter.flush().text
        if (partial) {
          await db.addMessage(conversationId, 'assistant', partial)
          await refreshAfterTurn(conversationId)
        }
        set({
          streamingContent: '',
          abortController: null,
          error: aborted
            ? null
            : getErrorMessage(e, 'Failed to get a response from the local model'),
        })
        setPhase('idle')
        flushQueued()
        return
      }

      const { text, scenes } = filter.flush()
      const replyText = text || rawReply.trim() || '…'

      // The reply is persisted before anything image-related: if the photo fails, the
      // user still has a normal turn rather than a lost one.
      const assistantMsg = await db.addMessage(conversationId, 'assistant', replyText)
      await refreshAfterTurn(conversationId)
      set({ streamingContent: '', abortController: null })

      const scene = scenes[0]
      const allowed = photosAvailable && Boolean(scene)

      if (allowed && scene) {
        const cooldown = settings?.auto_image_cooldown_turns ?? 2
        const cap = settings?.auto_image_max_per_conversation ?? 10
        const sent = await db.countImagesOfKind(conversationId, 'character_selfie')
        const sinceLast = countTurnsSinceLastSelfie(get().messages)

        if (sent < cap && sinceLast >= cooldown) {
          await sendSelfie({
            conversationId,
            messageId: assistantMsg.id,
            character: character!,
            scene,
          })
        }
      }

      setPhase('idle')

      void scheduleMemoryWork({
        conversationId,
        character,
        messages: get().messages,
        userName,
      })

      flushQueued()
    },

    generateImage: async (prompt) => {
      const trimmed = prompt.trim()
      if (!trimmed || get().turnPhase !== 'idle') return

      const settings = useSettingsStore.getState().settings
      if (!settings?.image_model_path) {
        set({ error: 'No Stable Diffusion model configured.' })
        return
      }

      let conversationId = get().activeConversationId
      let isFirstMessage = false

      if (!conversationId) {
        const character = useCharacterStore.getState().getActive()
        const conv = await db.createConversation(
          generateTitle(trimmed),
          character?.id ?? null,
        )
        conversationId = conv.id
        isFirstMessage = true
        set({ activeConversationId: conversationId })
      } else {
        isFirstMessage =
          get().messages.filter((m) => m.role === 'user' || m.role === 'image')
            .length === 0
      }

      const userMsg = await db.addMessage(conversationId, 'user', trimmed)
      if (isFirstMessage) {
        await db.updateConversation(conversationId, { title: generateTitle(trimmed) })
      }

      set({
        messages: [...get().messages, userMsg],
        conversations: await db.listConversations(),
      })

      await runJob({
        conversationId,
        originalPrompt: trimmed,
        enhance: get().enhancePrompt,
        kind: 'user_request',
      })
      set({ imageMode: false })
    },

    regenerateImage: async (messageId) => {
      if (get().turnPhase !== 'idle') return
      const source = get().messages.find((m) => m.id === messageId)
      if (!source?.image) return

      await runJob({
        conversationId: source.conversation_id,
        originalPrompt: source.image.original_prompt,
        precomposed: {
          prompt: source.image.enhanced_prompt || source.image.original_prompt,
          negative_prompt:
            useSettingsStore.getState().settings?.image_negative_prompt ?? '',
          seed: useSettingsStore.getState().settings?.image_random_seed
            ? -1
            : source.image.seed,
        },
        kind: 'regenerate',
      })
    },

    retryImageGeneration: async () => {
      const job = get().imageJob
      if (!job?.original_prompt || get().turnPhase !== 'idle') return
      await runJob({
        conversationId: job.conversation_id,
        originalPrompt: job.original_prompt,
        enhance: get().enhancePrompt && !job.enhanced_prompt,
        precomposed: job.enhanced_prompt
          ? {
              prompt: job.enhanced_prompt,
              negative_prompt:
                useSettingsStore.getState().settings?.image_negative_prompt ?? '',
              seed: -1,
            }
          : undefined,
        kind: 'user_request',
      })
      set({ imageMode: false })
    },

    deleteImageMessage: async (messageId) => {
      await db.deleteMessage(messageId)
      const conversationId = get().activeConversationId
      if (conversationId) {
        const messages = await db.listMessages(conversationId)
        set({ messages })
      } else {
        set({ messages: get().messages.filter((m) => m.id !== messageId) })
      }
    },

    downloadImage: async (imagePath) => {
      try {
        await saveImageAs(imagePath)
      } catch (e) {
        set({ error: getErrorMessage(e, 'Failed to save image') })
      }
    },

    openImageInFinder: async (imagePath) => {
      try {
        await revealImageInFinder(imagePath)
      } catch (e) {
        set({ error: getErrorMessage(e, 'Failed to open Finder') })
      }
    },

    cancelImageGeneration: () => {
      get().imageAbortController?.abort()
      void getImageGenerationProvider().cancel()
      set({ imageJob: null, imageAbortController: null })
      setPhase('idle')
    },

    stopGenerating: () => {
      get().abortController?.abort()
      set({ abortController: null })
      setPhase('idle')
    },

    clearError: () =>
      set({
        error: null,
        imageJob: get().imageJob?.status === 'error' ? null : get().imageJob,
      }),

    requestInputFocus: () =>
      set({ inputFocusToken: get().inputFocusToken + 1 }),
  }

  // ── Shared image execution ──────────────────────────────────────

  /**
   * Drives one image through the pipeline and keeps the in-flight placeholder in
   * step. Used by the chat tool, regenerate, retry and the character selfie path.
   */
  async function runJob(options: {
    conversationId: string
    originalPrompt: string
    kind: 'user_request' | 'regenerate' | 'character_selfie'
    enhance?: boolean
    precomposed?: { prompt: string; negative_prompt: string; seed: number }
    character?: Character | null
    scene?: string
    caption?: string
    attachToMessageId?: string | null
  }): Promise<boolean> {
    const settings = useSettingsStore.getState().settings
    const id = createId()
    const controller = new AbortController()

    set({
      imageAbortController: controller,
      error: null,
      imageJob: {
        id,
        conversation_id: options.conversationId,
        original_prompt: options.originalPrompt,
        enhanced_prompt: options.precomposed?.prompt ?? null,
        progress: 0,
        status: options.enhance ? 'enhancing' : 'generating',
        estimated_seconds: Math.max(8, Math.round((settings?.image_steps ?? 20) * 1.2)),
        started_at: Date.now(),
      },
    })
    setPhase('composing_image')

    try {
      await runImageGeneration(
        {
          conversationId: options.conversationId,
          kind: options.kind,
          originalPrompt: options.originalPrompt,
          precomposed: options.precomposed,
          character: options.character,
          scene: options.scene,
          enhance: options.enhance,
          caption: options.caption,
          attachToMessageId: options.attachToMessageId,
        },
        {
          signal: controller.signal,
          onPrompt: (prompt) => {
            const job = get().imageJob
            if (job?.id === id) set({ imageJob: { ...job, enhanced_prompt: prompt } })
          },
          onPhase: (phase) => {
            if (phase === 'pausing') setPhase('engine_pausing')
            else if (phase === 'generating') setPhase('generating_image')
            else if (phase === 'resuming') setPhase('engine_resuming')
            const job = get().imageJob
            if (job?.id === id && phase === 'generating') {
              set({ imageJob: { ...job, status: 'generating', progress: 5 } })
            }
          },
          onProgress: (event) => {
            const job = get().imageJob
            if (job?.id !== id) return
            set({ imageJob: { ...job, progress: event.progress, status: 'generating' } })
          },
        },
      )

      await refreshAfterTurn(options.conversationId)
      set({ imageJob: null, imageAbortController: null })
      setPhase('idle')
      return true
    } catch (e) {
      const aborted = controller.signal.aborted
      const message = getErrorMessage(e, 'Image generation failed')
      set({
        imageAbortController: null,
        imageJob: aborted
          ? null
          : get().imageJob
            ? { ...get().imageJob!, status: 'error', error: message, progress: 0 }
            : null,
        error: aborted ? null : message,
      })
      setPhase('idle')
      return false
    }
  }

  /**
   * The photo tail of a chat turn: the reply is already saved, so a failure here
   * leaves a normal message plus an error chip rather than losing the turn.
   */
  async function sendSelfie(options: {
    conversationId: string
    messageId: string
    character: Character
    scene: string
  }): Promise<void> {
    await runJob({
      conversationId: options.conversationId,
      originalPrompt: options.scene,
      kind: 'character_selfie',
      character: options.character,
      scene: options.scene,
      caption: options.scene,
      attachToMessageId: options.messageId,
    })
  }
})
