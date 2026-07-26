import { create } from 'zustand'
import type { Conversation, ImageGenerationJob, Message } from '@/types'
import * as db from '@/services/database'
import {
  buildBaseUrl,
  enhanceImagePrompt,
  streamChatCompletion,
} from '@/services/llamaClient'
import {
  getImageGenerationProvider,
  parseResolution,
  revealImageInFinder,
  saveImageAs,
} from '@/services/imageGeneration'
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

async function pauseChatEngineForImageGen(): Promise<() => Promise<void>> {
  const engine = useEngineStore.getState()
  const shouldRestart =
    engine.status === 'ready' ||
    engine.status === 'starting' ||
    engine.status === 'loading'

  if (shouldRestart) {
    try {
      await engine.stop()
    } catch {
      // Best effort: image generation can still proceed.
    }
  }

  return async () => {
    if (!shouldRestart) return
    try {
      await useEngineStore.getState().start()
    } catch {
      // Surface no extra error here; chat UI already shows engine status.
    }
  }
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

  /** Image generation (independent of text chat streaming) */
  isGeneratingImage: boolean
  imageJob: ImageGenerationJob | null
  imageMode: boolean
  enhancePrompt: boolean

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

export const useChatStore = create<ChatState>((set, get) => ({
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

  setImageMode: (enabled) => set({ imageMode: enabled }),

  setEnhancePrompt: (enabled) => {
    set({ enhancePrompt: enabled })
    void useSettingsStore.getState().update({ image_enhance_prompt: enabled })
  },

  sendMessage: async (content) => {
    const trimmed = content.trim()
    if (!trimmed) return

    // Image mode: route to image generation instead of chat
    if (get().imageMode) {
      await get().generateImage(trimmed)
      return
    }

    if (get().isGenerating) return

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

  generateImage: async (prompt) => {
    const trimmed = prompt.trim()
    if (!trimmed || get().isGeneratingImage) return

    const settings = useSettingsStore.getState().settings
    if (!settings?.image_model_path) {
      set({
        error: 'No Stable Diffusion model configured.',
      })
      return
    }

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
      isFirstMessage =
        get().messages.filter((m) => m.role === 'user' || m.role === 'image')
          .length === 0
    }

    const userMsg = await db.addMessage(conversationId, 'user', trimmed)

    if (isFirstMessage) {
      await db.updateConversation(conversationId, {
        title: generateTitle(trimmed),
      })
    }

    const jobId = createId()
    const shouldEnhance = get().enhancePrompt
    const estimatedSeconds = Math.max(
      8,
      Math.round((settings.image_steps ?? 20) * 1.2),
    )

    set({
      messages: [...get().messages, userMsg],
      conversations: await db.listConversations(),
      isGeneratingImage: true,
      error: null,
      imageJob: {
        id: jobId,
        conversation_id: conversationId,
        original_prompt: trimmed,
        enhanced_prompt: null,
        progress: 0,
        status: shouldEnhance ? 'enhancing' : 'generating',
        estimated_seconds: estimatedSeconds,
        started_at: Date.now(),
      },
    })

    const imageAbortController = new AbortController()
    set({ imageAbortController })
    const resumeChatEngine = await pauseChatEngineForImageGen()

    try {
      let finalPrompt = trimmed

      if (shouldEnhance) {
        try {
          const baseUrl = buildBaseUrl(
            settings.llama_host ?? '127.0.0.1',
            settings.llama_port ?? 8080,
          )
          finalPrompt = await enhanceImagePrompt(trimmed, {
            baseUrl,
            signal: imageAbortController.signal,
          })
        } catch {
          // Enhancement is best-effort; fall back to original
          finalPrompt = trimmed
        }

        set({
          imageJob: get().imageJob
            ? {
                ...get().imageJob!,
                enhanced_prompt: finalPrompt,
                status: 'generating',
                progress: 5,
              }
            : null,
        })
      }

      const { width, height } = parseResolution(
        settings.image_resolution ?? '512x512',
      )
      const seed = settings.image_random_seed
        ? -1
        : (settings.image_seed ?? -1)

      const provider = getImageGenerationProvider()
      const result = await provider.generate(
        {
          prompt: finalPrompt,
          negative_prompt: settings.image_negative_prompt,
          width,
          height,
          steps: settings.image_steps ?? 20,
          cfg_scale: settings.image_cfg_scale ?? 7,
          seed,
          sampler: settings.image_sampler ?? 'euler_a',
          model_path: settings.image_model_path,
          format: settings.image_format ?? 'png',
        },
        {
          jobId,
          signal: imageAbortController.signal,
          onProgress: (event) => {
            const job = get().imageJob
            if (!job || job.id !== jobId) return
            set({
              imageJob: {
                ...job,
                progress: event.progress,
                status: 'generating',
              },
            })
          },
        },
      )

      // Persist image message + metadata
      const imageMsg = await db.addMessage(conversationId, 'image', trimmed)
      const generated = await db.createGeneratedImage({
        conversation_id: conversationId,
        message_id: imageMsg.id,
        original_prompt: trimmed,
        enhanced_prompt: finalPrompt,
        image_path: result.image_path,
        width: result.width,
        height: result.height,
        seed: result.seed,
        sampler: settings.image_sampler ?? 'euler_a',
        steps: settings.image_steps ?? 20,
        cfg: settings.image_cfg_scale ?? 7,
        generation_time_ms: result.generation_time_ms,
      })

      const nextMessages = await db.listMessages(conversationId)
      // Ensure image is attached even if join missed it
      const withImage = nextMessages.map((m) =>
        m.id === imageMsg.id ? { ...m, image: generated } : m,
      )

      set({
        messages: withImage,
        conversations: await db.listConversations(),
        isGeneratingImage: false,
        imageJob: null,
        imageAbortController: null,
        imageMode: false,
      })
      await resumeChatEngine()
    } catch (e) {
      if (imageAbortController.signal.aborted) {
        set({
          isGeneratingImage: false,
          imageJob: null,
          imageAbortController: null,
        })
        await resumeChatEngine()
        return
      }

      const message = getErrorMessage(e, 'Image generation failed')
      set({
        isGeneratingImage: false,
        imageJob: get().imageJob
          ? {
              ...get().imageJob!,
              status: 'error',
              error: message,
              progress: 0,
            }
          : null,
        imageAbortController: null,
        error: message,
      })
      await resumeChatEngine()
    }
  },

  regenerateImage: async (messageId) => {
    if (get().isGeneratingImage) return

    const source = get().messages.find((m) => m.id === messageId)
    if (!source?.image) return

    const settings = useSettingsStore.getState().settings
    if (!settings?.image_model_path) {
      set({ error: 'No Stable Diffusion model configured.' })
      return
    }

    const conversationId = source.conversation_id
    const prompt = source.image.enhanced_prompt || source.image.original_prompt
    const originalPrompt = source.image.original_prompt
    const jobId = createId()
    const estimatedSeconds = Math.max(
      8,
      Math.round((settings.image_steps ?? 20) * 1.2),
    )

    set({
      isGeneratingImage: true,
      error: null,
      imageJob: {
        id: jobId,
        conversation_id: conversationId,
        original_prompt: originalPrompt,
        enhanced_prompt: prompt,
        progress: 0,
        status: 'generating',
        estimated_seconds: estimatedSeconds,
        started_at: Date.now(),
      },
    })

    const imageAbortController = new AbortController()
    set({ imageAbortController })
    const resumeChatEngine = await pauseChatEngineForImageGen()

    try {
      const { width, height } = parseResolution(
        settings.image_resolution ?? '512x512',
      )
      const seed = settings.image_random_seed
        ? -1
        : (settings.image_seed ?? -1)

      const provider = getImageGenerationProvider()
      const result = await provider.generate(
        {
          prompt,
          negative_prompt: settings.image_negative_prompt,
          width,
          height,
          steps: settings.image_steps ?? 20,
          cfg_scale: settings.image_cfg_scale ?? 7,
          seed,
          sampler: settings.image_sampler ?? 'euler_a',
          model_path: settings.image_model_path,
          format: settings.image_format ?? 'png',
        },
        {
          jobId,
          signal: imageAbortController.signal,
          onProgress: (event) => {
            const job = get().imageJob
            if (!job || job.id !== jobId) return
            set({
              imageJob: {
                ...job,
                progress: event.progress,
                status: 'generating',
              },
            })
          },
        },
      )

      const imageMsg = await db.addMessage(conversationId, 'image', originalPrompt)
      const generated = await db.createGeneratedImage({
        conversation_id: conversationId,
        message_id: imageMsg.id,
        original_prompt: originalPrompt,
        enhanced_prompt: prompt,
        image_path: result.image_path,
        width: result.width,
        height: result.height,
        seed: result.seed,
        sampler: settings.image_sampler ?? 'euler_a',
        steps: settings.image_steps ?? 20,
        cfg: settings.image_cfg_scale ?? 7,
        generation_time_ms: result.generation_time_ms,
      })

      const nextMessages = await db.listMessages(conversationId)
      const withImage = nextMessages.map((m) =>
        m.id === imageMsg.id ? { ...m, image: generated } : m,
      )

      set({
        messages: withImage,
        conversations: await db.listConversations(),
        isGeneratingImage: false,
        imageJob: null,
        imageAbortController: null,
      })
      await resumeChatEngine()
    } catch (e) {
      if (imageAbortController.signal.aborted) {
        set({
          isGeneratingImage: false,
          imageJob: null,
          imageAbortController: null,
        })
        await resumeChatEngine()
        return
      }
      const message = getErrorMessage(e, 'Image regeneration failed')
      set({
        isGeneratingImage: false,
        imageJob: get().imageJob
          ? {
              ...get().imageJob!,
              status: 'error',
              error: message,
            }
          : null,
        imageAbortController: null,
        error: message,
      })
      await resumeChatEngine()
    }
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
      set({
        error: getErrorMessage(e, 'Failed to save image'),
      })
    }
  },

  openImageInFinder: async (imagePath) => {
    try {
      await revealImageInFinder(imagePath)
    } catch (e) {
      set({
        error: getErrorMessage(e, 'Failed to open Finder'),
      })
    }
  },

  cancelImageGeneration: () => {
    get().imageAbortController?.abort()
    void getImageGenerationProvider().cancel()
    set({
      isGeneratingImage: false,
      imageJob: null,
      imageAbortController: null,
    })
  },

  retryImageGeneration: async () => {
    const job = get().imageJob
    if (!job?.original_prompt || get().isGeneratingImage) return

    // User message was already saved; re-run generation without duplicating it
    const settings = useSettingsStore.getState().settings
    if (!settings?.image_model_path) {
      set({ error: 'No Stable Diffusion model configured.' })
      return
    }

    const conversationId = job.conversation_id
    const trimmed = job.original_prompt
    const jobId = createId()
    const shouldEnhance = get().enhancePrompt
    const estimatedSeconds = Math.max(
      8,
      Math.round((settings.image_steps ?? 20) * 1.2),
    )

    set({
      isGeneratingImage: true,
      error: null,
      imageJob: {
        id: jobId,
        conversation_id: conversationId,
        original_prompt: trimmed,
        enhanced_prompt: job.enhanced_prompt,
        progress: 0,
        status: shouldEnhance ? 'enhancing' : 'generating',
        estimated_seconds: estimatedSeconds,
        started_at: Date.now(),
      },
    })

    const imageAbortController = new AbortController()
    set({ imageAbortController })
    const resumeChatEngine = await pauseChatEngineForImageGen()

    try {
      let finalPrompt = job.enhanced_prompt || trimmed

      if (shouldEnhance && !job.enhanced_prompt) {
        try {
          const baseUrl = buildBaseUrl(
            settings.llama_host ?? '127.0.0.1',
            settings.llama_port ?? 8080,
          )
          finalPrompt = await enhanceImagePrompt(trimmed, {
            baseUrl,
            signal: imageAbortController.signal,
          })
        } catch {
          finalPrompt = trimmed
        }
        set({
          imageJob: get().imageJob
            ? {
                ...get().imageJob!,
                enhanced_prompt: finalPrompt,
                status: 'generating',
                progress: 5,
              }
            : null,
        })
      }

      const { width, height } = parseResolution(
        settings.image_resolution ?? '512x512',
      )
      const seed = settings.image_random_seed
        ? -1
        : (settings.image_seed ?? -1)

      const result = await getImageGenerationProvider().generate(
        {
          prompt: finalPrompt,
          negative_prompt: settings.image_negative_prompt,
          width,
          height,
          steps: settings.image_steps ?? 20,
          cfg_scale: settings.image_cfg_scale ?? 7,
          seed,
          sampler: settings.image_sampler ?? 'euler_a',
          model_path: settings.image_model_path,
          format: settings.image_format ?? 'png',
        },
        {
          jobId,
          signal: imageAbortController.signal,
          onProgress: (event) => {
            const current = get().imageJob
            if (!current || current.id !== jobId) return
            set({
              imageJob: {
                ...current,
                progress: event.progress,
                status: 'generating',
              },
            })
          },
        },
      )

      const imageMsg = await db.addMessage(conversationId, 'image', trimmed)
      const generated = await db.createGeneratedImage({
        conversation_id: conversationId,
        message_id: imageMsg.id,
        original_prompt: trimmed,
        enhanced_prompt: finalPrompt,
        image_path: result.image_path,
        width: result.width,
        height: result.height,
        seed: result.seed,
        sampler: settings.image_sampler ?? 'euler_a',
        steps: settings.image_steps ?? 20,
        cfg: settings.image_cfg_scale ?? 7,
        generation_time_ms: result.generation_time_ms,
      })

      const nextMessages = await db.listMessages(conversationId)
      set({
        messages: nextMessages.map((m) =>
          m.id === imageMsg.id ? { ...m, image: generated } : m,
        ),
        conversations: await db.listConversations(),
        isGeneratingImage: false,
        imageJob: null,
        imageAbortController: null,
        imageMode: false,
      })
      await resumeChatEngine()
    } catch (e) {
      if (imageAbortController.signal.aborted) {
        set({
          isGeneratingImage: false,
          imageJob: null,
          imageAbortController: null,
        })
        await resumeChatEngine()
        return
      }
      const message = getErrorMessage(e, 'Image generation failed')
      set({
        isGeneratingImage: false,
        imageJob: get().imageJob
          ? {
              ...get().imageJob!,
              status: 'error',
              error: message,
            }
          : null,
        imageAbortController: null,
        error: message,
      })
      await resumeChatEngine()
    }
  },

  stopGenerating: () => {
    get().abortController?.abort()
    set({ abortController: null, isGenerating: false })
  },

  clearError: () => set({ error: null, imageJob: get().imageJob?.status === 'error' ? null : get().imageJob }),

  requestInputFocus: () =>
    set({ inputFocusToken: get().inputFocusToken + 1 }),
}))
