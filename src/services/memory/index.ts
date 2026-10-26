import type { Character, Message } from '@/types'
import * as db from '@/services/database'
import { buildBaseUrl } from '@/services/llamaClient'
import { useEngineStore } from '@/stores/engineStore'
import { extractFacts } from './facts'
import { summarizeConversation, uncoveredMessages } from './summarizer'

export { selectMemories } from './select'
export { effectiveImportance } from './facts'
export { keywordString, extractKeywords } from './keywords'
export { uncoveredMessages } from './summarizer'

/**
 * Background memory work: fold older turns into the rolling summary, then pull durable
 * facts out of the same window. Both run after the reply is already on screen, so they
 * never add latency to a turn.
 */

/** Cheap guard so one very long message still triggers a fold. */
const MIN_UNCOVERED_MESSAGES = 12

const inFlight = new Map<string, Promise<void>>()
/** Conversations whose memory work was skipped because the engine was paused. */
const pending = new Set<string>()
let controller: AbortController | null = null

/** Called at the top of every send so background work never competes with a reply. */
export function cancelBackgroundWork(): void {
  controller?.abort()
  controller = null
}

function engineIsReady(): boolean {
  return useEngineStore.getState().status === 'ready'
}

export interface MemoryWorkInput {
  conversationId: string
  /** Everyone in the conversation who should remember it. */
  characters: Character[]
  messages: Message[]
  userName: string
}

export async function scheduleMemoryWork(input: MemoryWorkInput): Promise<void> {
  const { conversationId } = input
  const characters = input.characters.filter((c) => c.memory_enabled)
  const character = characters[0]
  if (!character) return
  if (inFlight.has(conversationId)) return inFlight.get(conversationId)

  const settings = await db.getSettings()
  if (!settings.memory_enabled) return

  // The engine is stopped for the whole of an image generation. Remember the work and
  // drain it when the model is back rather than firing at a dead port.
  if (!engineIsReady()) {
    pending.add(conversationId)
    return
  }

  const summary = await db.getConversationSummary(conversationId)
  const uncovered = uncoveredMessages(input.messages, summary)
  if (uncovered.length < MIN_UNCOVERED_MESSAGES) return

  const baseUrl = buildBaseUrl(settings.llama_host, settings.llama_port)
  controller = new AbortController()
  const signal = controller.signal

  const run = (async () => {
    try {
      await summarizeConversation({
        conversationId,
        character,
        userName: settings.user_name || 'the user',
        messages: input.messages,
        baseUrl,
        signal,
      })

      if (signal.aborted) return

      await extractFacts(characters, uncovered, {
        baseUrl,
        signal,
        userName: settings.user_name || 'the user',
        conversationId,
      })
    } catch {
      // Memory is best-effort. A failed run is retried on the next turn, and the
      // watermark is only advanced on success, so nothing is lost.
    } finally {
      inFlight.delete(conversationId)
    }
  })()

  inFlight.set(conversationId, run)
  return run
}

/**
 * Drains work deferred while the engine was down. Wired to the engine store so a
 * photo-generating turn still gets its memory pass once the model is back.
 */
export function drainPendingMemoryWork(
  resolve: (conversationId: string) => MemoryWorkInput | null,
): void {
  if (!pending.size || !engineIsReady()) return
  const ids = [...pending]
  pending.clear()
  for (const id of ids) {
    const input = resolve(id)
    if (input) void scheduleMemoryWork(input)
  }
}

export function hasPendingMemoryWork(): boolean {
  return pending.size > 0
}
