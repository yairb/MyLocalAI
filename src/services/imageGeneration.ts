/**
 * Image generation service abstraction.
 *
 * The UI depends only on {@link ImageGenerationProvider}. Today we ship a
 * Stable Diffusion implementation (local .safetensors via stable-diffusion.cpp).
 * Future backends (SDXL, Flux, remote APIs) implement the same interface.
 */

import type {
  ImageBackend,
  ImageFormat,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageGenProgressEvent,
} from '@/types'
import { isTauri, tauriInvoke } from './tauri'

// ── Provider interface (future-ready) ──────────────────────────

export interface ImageGenerationProvider {
  readonly id: string
  readonly name: string

  generate(
    request: ImageGenerationRequest,
    options?: {
      jobId?: string
      onProgress?: (event: ImageGenProgressEvent) => void
      signal?: AbortSignal
    },
  ): Promise<ImageGenerationResult>

  cancel(): Promise<void>

  getModels(): Promise<string[]>

  isBusy(): Promise<boolean>
}

// ── Stable Diffusion provider (Tauri backend) ──────────────────

class StableDiffusionProvider implements ImageGenerationProvider {
  readonly id = 'stable-diffusion'
  readonly name = 'Stable Diffusion'

  private unlisten: (() => void) | null = null

  async generate(
    request: ImageGenerationRequest,
    options: {
      jobId?: string
      onProgress?: (event: ImageGenProgressEvent) => void
      signal?: AbortSignal
    } = {},
  ): Promise<ImageGenerationResult> {
    if (!isTauri()) {
      return mockGenerate(request, options)
    }

    const jobId = options.jobId ?? crypto.randomUUID()

    // Listen for progress events from the Rust backend
    if (options.onProgress) {
      const { listen } = await import('@tauri-apps/api/event')
      this.unlisten = await listen<ImageGenProgressEvent>(
        'image-gen-progress',
        (event) => {
          if (event.payload.job_id === jobId) {
            options.onProgress?.(event.payload)
          }
        },
      )
    }

    const onAbort = () => {
      void this.cancel()
    }
    options.signal?.addEventListener('abort', onAbort)

    try {
      const result = await tauriInvoke<ImageGenerationResult>('generate_image', {
        params: {
          job_id: jobId,
          prompt: request.prompt,
          negative_prompt: request.negative_prompt ?? null,
          width: request.width,
          height: request.height,
          steps: request.steps,
          cfg_scale: request.cfg_scale,
          seed: request.seed,
          sampler: request.sampler,
          model_path: request.model_path,
          format: request.format,
        },
      })
      return result
    } finally {
      options.signal?.removeEventListener('abort', onAbort)
      this.unlisten?.()
      this.unlisten = null
    }
  }

  async cancel(): Promise<void> {
    if (isTauri()) {
      await tauriInvoke('cancel_image_generation')
    }
  }

  async getModels(): Promise<string[]> {
    if (isTauri()) {
      return tauriInvoke<string[]>('list_local_image_models')
    }
    return []
  }

  async isBusy(): Promise<boolean> {
    if (isTauri()) {
      return tauriInvoke<boolean>('is_image_generating')
    }
    return false
  }
}

/**
 * Browser-dev mock: paints a simple canvas placeholder so the UI can be
 * exercised without Tauri / stable-diffusion.cpp.
 */
async function mockGenerate(
  request: ImageGenerationRequest,
  options: {
    jobId?: string
    onProgress?: (event: ImageGenProgressEvent) => void
  } = {},
): Promise<ImageGenerationResult> {
  const jobId = options.jobId ?? 'mock'
  const steps = request.steps
  const start = Date.now()

  for (let i = 1; i <= steps; i++) {
    await new Promise((r) => setTimeout(r, 40))
    options.onProgress?.({
      job_id: jobId,
      progress: (i / steps) * 100,
      step: i,
      total_steps: steps,
      message: `Step ${i}/${steps}`,
    })
  }

  // Create a data-URL PNG via canvas and store as blob URL (dev only)
  const canvas = document.createElement('canvas')
  canvas.width = request.width
  canvas.height = request.height
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, request.width, canvas.height)
  grad.addColorStop(0, '#1a1a2e')
  grad.addColorStop(0.5, '#16213e')
  grad.addColorStop(1, '#0f3460')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = '16px system-ui'
  ctx.textAlign = 'center'
  const lines = wrapText(request.prompt, 40)
  lines.slice(0, 8).forEach((line, i) => {
    ctx.fillText(line, canvas.width / 2, canvas.height / 2 - 40 + i * 22)
  })
  ctx.fillStyle = 'rgba(16,163,127,0.9)'
  ctx.font = '12px system-ui'
  ctx.fillText('Mock preview · configure SD model in Settings', canvas.width / 2, canvas.height - 24)

  const dataUrl = canvas.toDataURL(
    request.format === 'jpeg' ? 'image/jpeg' : 'image/png',
  )

  return {
    image_path: dataUrl,
    width: request.width,
    height: request.height,
    seed: request.seed < 0 ? Math.floor(Math.random() * 1e9) : request.seed,
    generation_time_ms: Date.now() - start,
  }
}

function wrapText(text: string, max: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const w of words) {
    if ((current + ' ' + w).trim().length > max) {
      if (current) lines.push(current)
      current = w
    } else {
      current = (current + ' ' + w).trim()
    }
  }
  if (current) lines.push(current)
  return lines
}

// ── Service facade ─────────────────────────────────────────────

let activeProvider: ImageGenerationProvider = new StableDiffusionProvider()

export function getImageGenerationProvider(): ImageGenerationProvider {
  return activeProvider
}

/** Swap the backend (e.g. future Flux / remote providers). */
export function setImageGenerationProvider(
  provider: ImageGenerationProvider,
): void {
  activeProvider = provider
}

export function parseResolution(
  resolution: string,
): { width: number; height: number } {
  const [w, h] = resolution.split('x').map(Number)
  return {
    width: Number.isFinite(w) && w > 0 ? w : 512,
    height: Number.isFinite(h) && h > 0 ? h : 512,
  }
}

export async function pickImageModelFile(
  backend: ImageBackend = 'sdcpp',
): Promise<string | null> {
  if (!isTauri()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const defaultPath = await getImageModelsDir()

  const selected = await open({
    title:
      backend === 'mlx'
        ? 'Select MLX model directory or Hugging Face repo clone'
        : 'Select Stable Diffusion model',
    defaultPath,
    multiple: false,
    directory: backend === 'mlx',
    filters:
      backend === 'mlx'
        ? undefined
        : [
            {
              name: 'Stable Diffusion models',
              extensions: ['safetensors', 'ckpt', 'gguf'],
            },
          ],
  })

  return typeof selected === 'string' ? selected : null
}

const CHECKPOINT_FILE_EXTENSIONS = ['.safetensors', '.ckpt', '.gguf']

export function isLikelyCheckpointFilePath(path: string): boolean {
  const lower = path.trim().toLowerCase()
  return CHECKPOINT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function getImageModelCompatibilityWarning(
  backend: ImageBackend,
  modelPath: string | null | undefined,
): string | null {
  if (!modelPath) return null
  if (backend === 'mlx') {
    if (isLikelyCheckpointFilePath(modelPath)) {
      return 'Current MLX backend does not accept single checkpoint files. Use a Hugging Face model id: stabilityai/sdxl-turbo or stabilityai/stable-diffusion-2-1-base.'
    }

    const isLikelyLocalPath =
      modelPath.startsWith('/') ||
      modelPath.startsWith('~/') ||
      modelPath.startsWith('./') ||
      modelPath.startsWith('../') ||
      /^[a-zA-Z]:[\\/]/.test(modelPath)

    if (isLikelyLocalPath) {
      return 'Current MLX backend expects a Hugging Face model id, not a local path. Try: stabilityai/sdxl-turbo (or alias sdxl).'
    }
  }
  return null
}

export async function getImageModelsDir(): Promise<string> {
  if (!isTauri()) {
    return '~/Library/Application Support/MyLocalAI/models/image'
  }
  return tauriInvoke<string>('get_image_models_dir')
}

export async function listLocalImageModels(): Promise<string[]> {
  return getImageGenerationProvider().getModels()
}

export async function saveImageAs(
  sourcePath: string,
): Promise<string | null> {
  if (!isTauri()) {
    // Browser: trigger download
    const a = document.createElement('a')
    a.href = sourcePath
    a.download = `image-${Date.now()}.png`
    a.click()
    return null
  }
  return tauriInvoke<string | null>('save_image_as', { sourcePath })
}

export async function revealImageInFinder(path: string): Promise<void> {
  if (!isTauri()) return
  await tauriInvoke('reveal_image_in_finder', { path })
}

export async function deleteMessage(id: string): Promise<void> {
  if (!isTauri()) return
  await tauriInvoke('delete_message', { id })
}

/** Convert a local filesystem path to a webview-displayable URL. */
export async function imagePathToSrc(path: string): Promise<string> {
  if (!path) return ''
  if (path.startsWith('data:') || path.startsWith('blob:') || path.startsWith('http')) {
    return path
  }
  if (isTauri()) {
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    return convertFileSrc(path)
  }
  return path
}

export type { ImageFormat, ImageGenerationRequest, ImageGenerationResult }
