import type { ChatCompletionMessage, StreamChunk } from '@/types'

/**
 * Sampling knobs beyond the OpenAI basics. llama-server accepts all of these on
 * /v1/chat/completions and ignores anything it doesn't recognise, so they are sent
 * only when defined and a mismatched build degrades rather than fails.
 */
export interface SamplingOptions {
  temperature?: number
  top_p?: number
  max_tokens?: number
  repeat_penalty?: number
  repeat_last_n?: number
  presence_penalty?: number
  frequency_penalty?: number
  min_p?: number
  top_k?: number
  stop?: string[]
  /**
   * DRY penalises a repeated *sequence* — an n-gram that continues a match already in
   * the context — instead of an individual token. That is the difference between
   * suppressing "she bit her lip" for the fourth time and suppressing the word "she".
   */
  dry_multiplier?: number
  dry_base?: number
  dry_allowed_length?: number
  dry_penalty_last_n?: number
  dry_sequence_breakers?: string[]
  /** XTC drops the most likely continuation part of the time, which is where cliches live. */
  xtc_probability?: number
  xtc_threshold?: number
  /** Explicit sampler chain, in order. XTC has to run after min_p and before temperature. */
  samplers?: string[]
}

export interface StreamOptions extends SamplingOptions {
  baseUrl?: string
  model?: string
  messages: ChatCompletionMessage[]
  signal?: AbortSignal
  onToken: (token: string) => void
  onDone?: () => void
  onError?: (error: Error) => void
}

/** Drops undefined keys so the request body stays at llama-server's own defaults. */
function samplingBody(options: SamplingOptions): Record<string, unknown> {
  const entries: [string, unknown][] = [
    ['temperature', options.temperature],
    ['top_p', options.top_p],
    ['max_tokens', options.max_tokens],
    ['repeat_penalty', options.repeat_penalty],
    ['repeat_last_n', options.repeat_last_n],
    ['presence_penalty', options.presence_penalty],
    ['frequency_penalty', options.frequency_penalty],
    ['min_p', options.min_p],
    ['top_k', options.top_k],
    ['stop', options.stop?.length ? options.stop : undefined],
    ['dry_multiplier', options.dry_multiplier],
    ['dry_base', options.dry_base],
    ['dry_allowed_length', options.dry_allowed_length],
    ['dry_penalty_last_n', options.dry_penalty_last_n],
    [
      'dry_sequence_breakers',
      options.dry_sequence_breakers?.length ? options.dry_sequence_breakers : undefined,
    ],
    ['xtc_probability', options.xtc_probability],
    ['xtc_threshold', options.xtc_threshold],
    ['samplers', options.samplers?.length ? options.samplers : undefined],
  ]
  return Object.fromEntries(entries.filter(([, v]) => v !== undefined))
}

const DEFAULT_BASE = 'http://127.0.0.1:8080'

/**
 * Stream a chat completion from llama.cpp's OpenAI-compatible API.
 * Tokens are delivered via onToken as they arrive (SSE).
 */
export async function streamChatCompletion(options: StreamOptions): Promise<void> {
  const {
    baseUrl = DEFAULT_BASE,
    model = 'local-model',
    messages,
    signal,
    onToken,
    onDone,
    onError,
    ...sampling
  } = options

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        messages,
        ...samplingBody({
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 2048,
          ...sampling,
        }),
        stream: true,
      }),
      signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(
        `llama.cpp error ${response.status}: ${text || response.statusText}`,
      )
    }

    if (!response.body) {
      throw new Error('No response body from llama.cpp')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue

        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') {
          onDone?.()
          return
        }

        try {
          const chunk = JSON.parse(data) as StreamChunk
          const content = chunk.choices?.[0]?.delta?.content
          if (content) onToken(content)
        } catch {
          // ignore malformed SSE chunks
        }
      }
    }

    onDone?.()
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      onDone?.()
      return
    }
    const error = err instanceof Error ? err : new Error(String(err))
    onError?.(error)
    throw error
  }
}

/** Health check against llama-server */
export async function checkLlamaHealth(
  baseUrl = DEFAULT_BASE,
): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(`${baseUrl}/health`, {
      signal: controller.signal,
    }).catch(async () =>
      fetch(`${baseUrl}/v1/models`, { signal: controller.signal }),
    )
    clearTimeout(timeout)
    return res.ok
  } catch {
    return false
  }
}

export function buildBaseUrl(host: string, port: number): string {
  return `http://${host}:${port}`
}

export interface CompleteOptions extends SamplingOptions {
  baseUrl?: string
  model?: string
  messages: ChatCompletionMessage[]
  signal?: AbortSignal
}

/**
 * Non-streaming chat completion (used for prompt enhancement, titles, etc.).
 */
export async function completeChat(
  options: CompleteOptions,
): Promise<string> {
  const {
    baseUrl = DEFAULT_BASE,
    model = 'local-model',
    messages,
    signal,
    ...sampling
  } = options

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      ...samplingBody({
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 512,
        ...sampling,
      }),
      stream: false,
    }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `llama.cpp error ${response.status}: ${text || response.statusText}`,
    )
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

const PROMPT_ENGINEER_SYSTEM = `You are an expert Stable Diffusion prompt engineer.
Convert the user's request into an extremely detailed Stable Diffusion prompt.
Do not answer conversationally.
Return ONLY the improved prompt.
Include:
lighting
camera
style
materials
composition
colors
high quality keywords
Do not explain anything.`

/**
 * Enhance a short user image request into a detailed SD prompt via the local LLM.
 */
export async function enhanceImagePrompt(
  userPrompt: string,
  options: {
    baseUrl?: string
    signal?: AbortSignal
  } = {},
): Promise<string> {
  const raw = await completeChat({
    baseUrl: options.baseUrl,
    temperature: 0.75,
    top_p: 0.9,
    max_tokens: 300,
    signal: options.signal,
    messages: [
      { role: 'system', content: PROMPT_ENGINEER_SYSTEM },
      { role: 'user', content: userPrompt },
    ],
  })

  // Strip accidental quotes or markdown fences
  return raw
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .replace(/^["']|["']$/g, '')
    .trim() || userPrompt
}

/** Exact token count from llama-server. Used to calibrate the estimator, not per turn. */
export async function tokenize(
  text: string,
  baseUrl = DEFAULT_BASE,
  signal?: AbortSignal,
): Promise<number> {
  const res = await fetch(`${baseUrl}/tokenize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text }),
    signal,
  })
  if (!res.ok) throw new Error(`tokenize failed: ${res.status}`)
  const data = (await res.json()) as { tokens?: unknown[] }
  if (!Array.isArray(data.tokens)) throw new Error('tokenize returned no tokens')
  return data.tokens.length
}

/**
 * The real context window. `--parallel` defaults to auto, which splits the configured
 * context across server slots, so the setting alone can overstate what a request gets.
 */
export async function getServerContextWindow(
  baseUrl = DEFAULT_BASE,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const res = await fetch(`${baseUrl}/props`, { signal })
    if (!res.ok) return null
    const data = (await res.json()) as {
      default_generation_settings?: { n_ctx?: number }
      n_ctx?: number
    }
    const n = data.default_generation_settings?.n_ctx ?? data.n_ctx
    return typeof n === 'number' && n > 0 ? n : null
  } catch {
    return null
  }
}
