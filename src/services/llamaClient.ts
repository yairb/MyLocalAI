import type { ChatCompletionMessage, StreamChunk } from '@/types'

export interface StreamOptions {
  baseUrl?: string
  model?: string
  messages: ChatCompletionMessage[]
  temperature?: number
  top_p?: number
  max_tokens?: number
  signal?: AbortSignal
  onToken: (token: string) => void
  onDone?: () => void
  onError?: (error: Error) => void
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
    temperature = 0.7,
    top_p = 0.9,
    max_tokens = 2048,
    signal,
    onToken,
    onDone,
    onError,
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
        temperature,
        top_p,
        max_tokens,
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
