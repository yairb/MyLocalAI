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
import { createSentinelFilter } from '@/services/imageDirector'
import {
  cancelBackgroundWork,
  scheduleMemoryWork,
  selectMemories,
} from '@/services/memory'
import {
  coalesce,
  pickSpeaker,
  renderGroupMessage,
} from '@/services/groupChat'
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
  if (message.role === 'image') {
    // A picture of the character is part of the scene; a generic tool image is not.
    const caption = message.image?.caption
    return message.image?.kind === 'character_selfie' && caption
      ? { role: 'assistant', content: `[you sent a picture: ${caption}]` }
      : null
  }
  if (message.role !== 'assistant') return null
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

/**
 * Drops a leading "Name:" the model sometimes writes in a group, where every other
 * line in the transcript is labelled and the pattern is contagious.
 */
function stripOwnName(text: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`^\\s*${escaped}\\s*:\\s*`, 'i'), '').trim()
}

/** Persists the character's opening line so it is part of history, not just UI. */
async function ensureGreeting(
  conversationId: string,
  character: Character | null,
): Promise<Message[]> {
  const greeting = character?.greeting?.trim()
  if (!greeting || !character) return []
  const existing = await db.listMessages(conversationId)
  if (existing.length > 0) return existing
  const message = await db.addMessage(
    conversationId,
    'assistant',
    greeting,
    character.id,
  )
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

  /** Characters in the active conversation, in speaking order. */
  participantIds: string[]
  /** Who is composing right now, for the header and the typing bubble. */
  speakingCharacterId: string | null

  /** The whole turn, including the photo tail. */
  turnPhase: TurnPhase
  /** Typed while the engine was down; sent automatically once the turn finishes. */
  queuedMessage: string | null

  /** Image generation (independent of text chat streaming) */
  isGeneratingImage: boolean
  imageJob: ImageGenerationJob | null
  imageMode: boolean
  enhancePrompt: boolean
  /** Compose the picture around the conversation's character, with their locked seed. */
  imageAsCharacter: boolean

  loadConversations: () => Promise<void>
  setSearchQuery: (q: string) => void
  selectConversation: (id: string | null) => Promise<void>
  newChat: (characterId?: string) => Promise<void>
  setConversationParticipants: (characterIds: string[]) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  setConversationCharacter: (conversationId: string, characterId: string) => Promise<void>
  sendMessage: (content: string) => Promise<void>
  stopGenerating: () => void
  clearError: () => void
  requestInputFocus: () => void

  setImageMode: (enabled: boolean) => void
  setEnhancePrompt: (enabled: boolean) => void
  setImageAsCharacter: (enabled: boolean) => void
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

    participantIds: [],
    speakingCharacterId: null,
    turnPhase: 'idle',
    queuedMessage: null,

    isGeneratingImage: false,
    imageJob: null,
    imageMode: false,
    enhancePrompt: true,
    imageAsCharacter: true,

    loadConversations: async () => {
      const conversations = await db.listConversations()
      set({ conversations })
    },

    setSearchQuery: (q) => set({ searchQuery: q }),

    selectConversation: async (id) => {
      if (get().isGenerating) get().stopGenerating()
      if (!id) {
        set({ activeConversationId: null, messages: [], participantIds: [] })
        return
      }
      const [messages, stored] = await Promise.all([
        db.listMessages(id),
        db.listParticipants(id),
      ])

      // Conversations from before group chats have no participant rows. Backfill from
      // the character they were created with, so the cast menu adds rather than
      // replaces the first time it is used.
      let participantIds = stored
      if (!participantIds.length) {
        const conversation = get().conversations.find((c) => c.id === id)
        const solo = useCharacterStore.getState().getForConversation(conversation ?? null)
        if (solo) {
          participantIds = [solo.id]
          await db.setParticipants(id, participantIds)
        }
      }

      set({ activeConversationId: id, messages, participantIds, error: null })
    },

    newChat: async (characterId) => {
      if (get().isGenerating) get().stopGenerating()
      const characters = useCharacterStore.getState()
      const character =
        (characterId ? characters.getById(characterId) : null) ?? characters.getActive()
      const conv = await db.createConversation('New Chat', character?.id ?? null)
      if (character) await db.setParticipants(conv.id, [character.id])
      const messages = await ensureGreeting(conv.id, character)
      const conversations = await db.listConversations()
      set({
        conversations,
        activeConversationId: conv.id,
        messages,
        participantIds: character ? [character.id] : [],
        error: null,
        inputFocusToken: get().inputFocusToken + 1,
      })
    },

    setConversationParticipants: async (characterIds) => {
      const conversationId = get().activeConversationId
      if (!conversationId || !characterIds.length) return
      await db.setParticipants(conversationId, characterIds)
      set({
        participantIds: characterIds,
        conversations: await db.listConversations(),
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

    setImageAsCharacter: (enabled) => set({ imageAsCharacter: enabled }),

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
      let isFirstMessage = false

      if (!conversationId) {
        const character = resolveCharacter(null)
        const conv = await db.createConversation(
          generateTitle(trimmed),
          character?.id ?? null,
        )
        conversationId = conv.id
        isFirstMessage = true
        if (character) await db.setParticipants(conversationId, [character.id])
        set({
          activeConversationId: conversationId,
          participantIds: character ? [character.id] : [],
          conversations: await db.listConversations(),
        })
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

      set({
        messages: [...get().messages, userMsg],
        conversations: await db.listConversations(),
        streamingContent: '',
        error: null,
      })

      const participants = resolveParticipants(conversationId)
      if (!participants.length) {
        set({ error: 'No character is set up for this chat.' })
        return
      }

      // In a group, more than one voice may answer the same message. Each reply is a
      // full generation, so the default is one and the cap is the cast size.
      const maxReplies =
        participants.length > 1
          ? Math.max(1, Math.min(settings?.group_replies_per_turn ?? 1, participants.length))
          : 1

      const spoken: string[] = []
      for (let turn = 0; turn < maxReplies; turn += 1) {
        const speaker = pickSpeaker({
          participants,
          messages: get().messages,
          userText: turn === 0 ? trimmed : undefined,
          exclude: spoken,
        })
        if (!speaker) break

        const completed = await generateReply({
          conversationId,
          speaker,
          participants,
          userText: turn === 0 ? trimmed : undefined,
        })
        if (!completed) break
        spoken.push(speaker.id)
      }

      setPhase('idle')
      set({ speakingCharacterId: null })

      void scheduleMemoryWork({
        conversationId,
        characters: participants.filter((c) => spoken.includes(c.id)),
        messages: get().messages,
        userName: settings?.user_name?.trim() || 'the user',
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

      // With a character in the conversation the picture is of them: their appearance
      // leads the prompt and their seed is reused, so the face stays the same.
      const subject = resolveParticipants(conversationId)[0] ?? null
      const asCharacter =
        get().imageAsCharacter && Boolean(subject?.appearance_prompt.trim())

      await runJob({
        conversationId,
        originalPrompt: trimmed,
        enhance: !asCharacter && get().enhancePrompt,
        character: asCharacter ? subject : null,
        scene: asCharacter ? trimmed : undefined,
        kind: asCharacter ? 'character_selfie' : 'user_request',
        caption: asCharacter ? trimmed : undefined,
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

  /** Everyone in this conversation, in speaking order, with a solo fallback. */
  function resolveParticipants(conversationId: string | null): Character[] {
    const characters = useCharacterStore.getState()
    const ids = get().participantIds
    const resolved = ids
      .map((id) => characters.getById(id))
      .filter((c): c is Character => c !== null)
    if (resolved.length) return resolved
    const solo = resolveCharacter(conversationId)
    return solo ? [solo] : []
  }

  /**
   * One character's reply: assemble their view of the conversation, stream it, save
   * it, and send the photo if they reached for one. Returns false when nothing was
   * produced, which stops any further speakers this turn.
   */
  async function generateReply(options: {
    conversationId: string
    speaker: Character
    participants: Character[]
    userText?: string
  }): Promise<boolean> {
    const { conversationId, speaker, participants } = options
    const settings = useSettingsStore.getState().settings
    const characters = useCharacterStore.getState()
    const isGroup = participants.length > 1
    const others = isGroup ? participants.filter((c) => c.id !== speaker.id) : null

    const userLabel = settings?.user_name?.trim() || 'User'

    const [summaryRow, allMemories] = await Promise.all([
      db.getConversationSummary(conversationId),
      speaker.memory_enabled && settings?.memory_enabled
        ? db.listMemories(speaker.id)
        : Promise.resolve([]),
    ])

    const messages = get().messages
    const facts = allMemories.length
      ? selectMemories({
          memories: allMemories,
          recentMessages: messages,
          budgetChars: 1200,
        })
      : []

    const persona = buildSystemPrompt({
      character: speaker,
      userName: settings?.user_name,
      userPersona: settings?.user_persona,
      memory: { summary: summaryRow?.summary ?? null, facts },
      others,
    })

    const engine = useEngineStore.getState()
    const contextWindow = engine.contextWindow ?? settings?.context_size ?? 4096
    const params = resolveGenerationParams(
      speaker,
      settings ?? null,
      settings?.user_name,
      others,
    )

    const packed = packContext({
      contextWindow,
      maxTokens: params.max_tokens,
      persona,
      messages,
      estimator: createEstimator(engine.charsPerToken ?? undefined),
      // In a group the transcript is written from this speaker's point of view:
      // their own turns are the assistant's, everyone else arrives labelled.
      renderMessage: isGroup
        ? (message) =>
            renderGroupMessage(message, {
              speakerId: speaker.id,
              userLabel,
              characterName: (id) => characters.getById(id)?.name ?? null,
            })
        : renderForModel,
    })

    const chatMessages = isGroup
      ? coalesce(packed.chatMessages)
      : [...packed.chatMessages]

    const baseUrl = buildBaseUrl(
      settings?.llama_host ?? '127.0.0.1',
      settings?.llama_port ?? 8080,
    )

    const abortController = new AbortController()
    const filter = createSentinelFilter()
    let rawReply = ''

    set({ abortController, streamingContent: '', speakingCharacterId: speaker.id })
    setPhase('streaming')

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
        await db.addMessage(conversationId, 'assistant', partial, speaker.id)
        await refreshAfterTurn(conversationId)
      }
      set({
        streamingContent: '',
        abortController: null,
        speakingCharacterId: null,
        error: aborted
          ? null
          : getErrorMessage(e, 'Failed to get a response from the local model'),
      })
      setPhase('idle')
      return false
    }

    // The filter stays as a safety net: a model that emits an image tag anyway gets
    // it stripped from the reply rather than showing the user raw brackets.
    const { text } = filter.flush()
    // The model occasionally labels its own line despite being told not to.
    const replyText =
      stripOwnName(text || rawReply.trim(), speaker.name) || '…'

    // Saved before anything image-related: a failed photo must not cost the reply.
    await db.addMessage(conversationId, 'assistant', replyText, speaker.id)
    await refreshAfterTurn(conversationId)
    set({ streamingContent: '', abortController: null, speakingCharacterId: null })
    return true
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
    characterId?: string | null
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
          characterId: options.characterId ?? options.character?.id ?? null,
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
})
