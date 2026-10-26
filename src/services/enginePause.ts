import { useEngineStore } from '@/stores/engineStore'

/**
 * Stops llama-server for the duration of an image generation so the two models are not
 * competing for the GPU, and hands back a resume function.
 *
 * Lives here rather than in chatStore because three callers need it: chat image
 * generation, a character sending a photo, and avatar generation from the editor.
 *
 * Note that anything needing the LLM — prompt enhancement especially — must run
 * BEFORE this is called, and anything after must await `resume()`, which waits for the
 * model to finish loading rather than just for the process to spawn.
 */
export async function pauseChatEngineForImageGen(): Promise<() => Promise<void>> {
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
      await useEngineStore.getState().waitForReady()
    } catch {
      // The chat UI already surfaces engine status; no extra error here.
    }
  }
}
