import type { ChatCompletionMessage, Message } from '@/types'
import { getServerContextWindow, tokenize } from './llamaClient'

/**
 * Packs a conversation into the model's context window.
 *
 * This is a correctness fix, not a tuning knob: the installed llama.cpp has
 * `--context-shift` disabled by default, so a request that overflows the window comes
 * back as an HTTP 400 and the user loses the turn entirely.
 */

/** Per-message overhead the chat template adds (role tags, separators). */
const PER_MESSAGE_TOKENS = 4
const PREAMBLE_TOKENS = 8
const DEFAULT_CHARS_PER_TOKEN = 3.6

export interface TokenEstimator {
  estimate(text: string): number
  charsPerToken: number
}

export function createEstimator(charsPerToken = DEFAULT_CHARS_PER_TOKEN): TokenEstimator {
  const ratio = charsPerToken > 0 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN
  return {
    charsPerToken: ratio,
    estimate: (text) => Math.ceil((text?.length ?? 0) / ratio),
  }
}

/**
 * Measures this model's real chars-per-token on a sample of actual conversation text.
 * Called once per model load — a tokenize round trip per turn would mean ~40 requests
 * per packed context, and the endpoint is unreachable exactly when the engine is
 * paused for image generation.
 */
export async function calibrateEstimator(
  sample: string,
  baseUrl: string,
): Promise<number> {
  const text = sample.slice(0, 4000)
  if (text.length < 200) return DEFAULT_CHARS_PER_TOKEN
  const tokens = await tokenize(text, baseUrl)
  if (!tokens) return DEFAULT_CHARS_PER_TOKEN
  const ratio = text.length / tokens
  // Guard against a nonsense reading rather than trusting it blindly.
  return ratio >= 1 && ratio <= 8 ? ratio : DEFAULT_CHARS_PER_TOKEN
}

export async function resolveContextWindow(
  baseUrl: string,
  fallback: number,
): Promise<number> {
  const reported = await getServerContextWindow(baseUrl)
  return reported ?? fallback
}

/**
 * A directive placed near the end of the history rather than in the system prompt.
 *
 * A 4k-window model stops attending to the top of its context once a scene is a dozen
 * turns long, which is exactly when the format and momentum rules are needed most. The
 * note is cheap — a few dozen tokens — and sits where the model is still looking.
 */
export interface DepthNote {
  content: string
  /** How many messages follow it. 1 puts it directly above the newest turn. */
  depth: number
}

export interface BudgetInput {
  contextWindow: number
  /** The ceiling from settings; the reply reservation is clamped below it. */
  maxTokens: number
  persona: string
  messages: Message[]
  estimator: TokenEstimator
  /** Renders a message for the model — e.g. folding a photo caption into the text. */
  renderMessage?: (message: Message) => ChatCompletionMessage | null
  /** Injected into the packed history once it is built. */
  depthNote?: DepthNote | null
}

export interface PackedContext {
  chatMessages: ChatCompletionMessage[]
  usedTokens: number
  replyReservation: number
  oldestKeptMessageId: string | null
  droppedCount: number
  /** True when even the trimmed-down context had to give something up. */
  overflow: boolean
}

function defaultRender(message: Message): ChatCompletionMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null
  return { role: message.role, content: message.content }
}

/** Keeps the head and tail of an oversized message and marks the gap. */
function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const half = Math.floor((maxChars - 20) / 2)
  return `${text.slice(0, half)}\n…[trimmed]…\n${text.slice(-half)}`
}

export function packContext(input: BudgetInput): PackedContext {
  const { contextWindow, maxTokens, persona, messages, estimator } = input
  const render = input.renderMessage ?? defaultRender

  // llama.cpp counts prompt + generated tokens against n_ctx, so the reply has to be
  // reserved up front. The default max_tokens (2048) against a 4096 window would
  // otherwise leave nothing at all for history.
  const replyReservation = Math.max(
    64,
    Math.min(maxTokens, Math.floor(contextWindow * 0.25)),
  )
  const safety = Math.max(64, Math.ceil(contextWindow * 0.05)) + PREAMBLE_TOKENS
  const available = Math.max(0, contextWindow - replyReservation - safety)

  const personaTokens = estimator.estimate(persona) + PER_MESSAGE_TOKENS

  // Charged before the walk, never after: the note must not be the thing that pushes a
  // request over the window, and a turn is worth more than the directive about it.
  const note = input.depthNote?.content.trim() ? input.depthNote : null
  const noteTokens = note ? estimator.estimate(note.content) + PER_MESSAGE_TOKENS : 0

  let remaining = available - personaTokens - noteTokens

  const rendered = messages
    .map((m) => ({ message: m, chat: render(m) }))
    .filter((x): x is { message: Message; chat: ChatCompletionMessage } => x.chat !== null)

  const kept: ChatCompletionMessage[] = []
  let oldestKeptMessageId: string | null = null
  let dropped = 0
  let overflow = false

  for (let i = rendered.length - 1; i >= 0; i -= 1) {
    const { message, chat } = rendered[i]
    const cost = estimator.estimate(chat.content) + PER_MESSAGE_TOKENS

    if (cost <= remaining) {
      kept.unshift(chat)
      oldestKeptMessageId = message.id
      remaining -= cost
      continue
    }

    // The newest message is the one the user is waiting on an answer to: keep it even
    // if it alone is oversized, trimmed down to whatever room is left.
    if (kept.length === 0) {
      const budgetChars = Math.max(200, Math.floor(remaining * estimator.charsPerToken))
      kept.unshift({ ...chat, content: truncateMiddle(chat.content, budgetChars) })
      oldestKeptMessageId = message.id
      remaining = 0
      overflow = true
      continue
    }

    dropped = i + 1
    overflow = true
    break
  }

  // Counted from the end, so the note keeps its distance from the generation point
  // however much history happened to fit.
  if (note) {
    const at = Math.max(0, kept.length - note.depth)
    kept.splice(at, 0, { role: 'user', content: note.content })
  }

  const chatMessages: ChatCompletionMessage[] = [
    { role: 'system', content: persona },
    ...kept,
  ]

  const usedTokens =
    personaTokens +
    kept.reduce((sum, m) => sum + estimator.estimate(m.content) + PER_MESSAGE_TOKENS, 0)

  return {
    chatMessages,
    usedTokens,
    replyReservation,
    oldestKeptMessageId,
    droppedCount: dropped,
    overflow,
  }
}
