import type {
  AppSettings,
  Character,
  GeneratedImage,
  ImageGenProgressEvent,
  ImageKind,
  ImageGenerationResult,
  Message,
} from '@/types'
import * as db from '@/services/database'
import { buildBaseUrl, completeChat, enhanceImagePrompt } from '@/services/llamaClient'
import {
  getImageGenerationProvider,
  parseResolution,
} from '@/services/imageGeneration'
import { pauseChatEngineForImageGen } from '@/services/enginePause'
import { buildCharacterImagePrompt } from '@/services/personaPrompt'
import {
  SCENE_ENHANCER_SYSTEM,
  SCENE_ENHANCE_THRESHOLD,
} from '@/services/imageDirector'

/**
 * The single path every image goes through: the chat tool, regenerate, a character
 * sending a selfie, and avatar generation.
 *
 * It exists mainly to get the ordering right. Prompt enhancement needs the LLM, and
 * generation kills the LLM to free the GPU — so enhancement must happen first. The
 * previous inline copies paused the engine and *then* called the enhancer against the
 * port they had just closed, which failed silently into the raw prompt every time.
 */

export type ImageRequestKind = ImageKind | 'regenerate'

export interface RunImageGenerationInput {
  conversationId: string | null
  kind: ImageRequestKind
  /** What the user typed, or what the character described. Stored and searchable. */
  originalPrompt: string
  /** Already-composed prompt; skips enhancement entirely. */
  precomposed?: { prompt: string; negative_prompt: string; seed: number }
  /** Character whose look must survive the scene, for selfies and avatars. */
  character?: Character | null
  /** Free-text scene, used with `character` to compose a consistent image. */
  scene?: string
  /** Run the generic SD prompt enhancer. Ignored when `precomposed` is given. */
  enhance?: boolean
  /** Shown under a character selfie as its own words. */
  caption?: string
  /** Attach to an existing message instead of minting a role:'image' one. */
  attachToMessageId?: string | null
  /** Credits the picture to a character, so it can be rendered and recalled as theirs. */
  characterId?: string | null
  /** false for avatars: generate the file, write nothing to the conversation. */
  persist?: boolean
  portrait?: boolean
  resolution?: string
}

export type ImagePhase = 'enhancing' | 'pausing' | 'generating' | 'resuming'

export interface RunImageGenerationCallbacks {
  onPhase?: (phase: ImagePhase) => void
  onProgress?: (event: ImageGenProgressEvent) => void
  signal?: AbortSignal
  /** The composed prompt, surfaced early so a placeholder can show it. */
  onPrompt?: (prompt: string) => void
}

export interface RunImageGenerationOutput {
  result: ImageGenerationResult
  finalPrompt: string
  message: Message | null
  image: GeneratedImage | null
}

function jobId(): string {
  return crypto.randomUUID()
}

/**
 * Expands a thin scene without touching the character's appearance. The generic
 * enhancer is not usable here: it rewrites the subject freely, which is precisely
 * what destroys a consistent face.
 */
async function enhanceScene(
  character: Character,
  scene: string,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const raw = await completeChat({
      baseUrl,
      temperature: 0.7,
      max_tokens: 200,
      signal,
      messages: [
        { role: 'system', content: SCENE_ENHANCER_SYSTEM },
        {
          role: 'user',
          content: `SUBJECT (do not describe): ${character.appearance_prompt}\nSCENE: ${scene}`,
        },
      ],
    })
    const cleaned = raw
      .replace(/^```[\w]*\n?/, '')
      .replace(/\n?```$/, '')
      .replace(/\s+/g, ' ')
      .trim()
    return cleaned || scene
  } catch {
    return scene
  }
}

async function composePrompt(
  input: RunImageGenerationInput,
  settings: AppSettings,
  cb?: RunImageGenerationCallbacks,
): Promise<{ prompt: string; negative_prompt: string; seed: number }> {
  if (input.precomposed) return input.precomposed

  const baseUrl = buildBaseUrl(settings.llama_host, settings.llama_port)

  // Character images: identity first, locked seed, scene-only enhancement.
  if (input.character) {
    let scene = input.scene ?? ''
    if (
      !input.portrait &&
      settings.image_enhance_prompt &&
      scene.length > 0 &&
      scene.length < SCENE_ENHANCE_THRESHOLD
    ) {
      cb?.onPhase?.('enhancing')
      scene = await enhanceScene(input.character, scene, baseUrl, cb?.signal)
    }
    return buildCharacterImagePrompt(input.character, scene, {
      portrait: input.portrait,
      baseNegative: settings.image_negative_prompt,
      styleSuffix: settings.image_style_suffix,
    })
  }

  // Standalone tool: unchanged behaviour, but now actually reached while the engine
  // is still running.
  let prompt = input.originalPrompt
  if (input.enhance) {
    cb?.onPhase?.('enhancing')
    try {
      prompt = await enhanceImagePrompt(input.originalPrompt, {
        baseUrl,
        signal: cb?.signal,
      })
    } catch {
      prompt = input.originalPrompt
    }
  }

  return {
    prompt,
    negative_prompt: settings.image_negative_prompt,
    seed: settings.image_random_seed ? -1 : (settings.image_seed ?? -1),
  }
}

export async function runImageGeneration(
  input: RunImageGenerationInput,
  cb?: RunImageGenerationCallbacks,
): Promise<RunImageGenerationOutput> {
  const settings = await db.getSettings()
  if (!settings.image_model_path) {
    throw new Error('No image model configured.')
  }

  const composed = await composePrompt(input, settings, cb)
  cb?.onPrompt?.(composed.prompt)

  const { width, height } = parseResolution(
    (input.resolution ?? settings.image_resolution) as AppSettings['image_resolution'],
  )
  const id = jobId()

  cb?.onPhase?.('pausing')
  const resume = await pauseChatEngineForImageGen()

  let result: ImageGenerationResult
  try {
    cb?.onPhase?.('generating')
    result = await getImageGenerationProvider().generate(
      {
        prompt: composed.prompt,
        negative_prompt: composed.negative_prompt,
        width,
        height,
        steps: settings.image_steps ?? 20,
        cfg_scale: settings.image_cfg_scale ?? 7,
        seed: composed.seed,
        sampler: settings.image_sampler ?? 'euler_a',
        model_path: settings.image_model_path,
        format: settings.image_format ?? 'png',
      },
      { jobId: id, signal: cb?.signal, onProgress: cb?.onProgress },
    )
  } finally {
    // Always restart, even on failure: leaving llama-server down would show the user
    // "no model" with no obvious cause. Awaited, because `resume` waits for the model
    // to finish loading and everything after this point needs a live engine.
    cb?.onPhase?.('resuming')
    await resume()
  }

  if (input.persist === false || !input.conversationId) {
    return { result, finalPrompt: composed.prompt, message: null, image: null }
  }

  const storedKind: ImageKind =
    input.kind === 'regenerate' ? 'user_request' : input.kind

  const message =
    input.attachToMessageId === undefined || input.attachToMessageId === null
      ? await db.addMessage(
          input.conversationId,
          'image',
          input.originalPrompt,
          input.characterId ?? null,
        )
      : null

  const messageId = input.attachToMessageId ?? message?.id
  if (!messageId) {
    return { result, finalPrompt: composed.prompt, message: null, image: null }
  }

  const image = await db.createGeneratedImage({
    conversation_id: input.conversationId,
    message_id: messageId,
    original_prompt: input.originalPrompt,
    enhanced_prompt: composed.prompt,
    image_path: result.image_path,
    width: result.width,
    height: result.height,
    seed: result.seed,
    sampler: settings.image_sampler ?? 'euler_a',
    steps: settings.image_steps ?? 20,
    cfg: settings.image_cfg_scale ?? 7,
    generation_time_ms: result.generation_time_ms,
    caption: input.caption ?? '',
    kind: storedKind,
  })

  return { result, finalPrompt: composed.prompt, message, image }
}
