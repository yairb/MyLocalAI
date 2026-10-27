/**
 * Image prompt helpers, plus a guard against stray image sentinels.
 *
 * Characters used to be able to decide mid-reply to send a photo. That is gone:
 * generating one stops llama-server to free the GPU and then reloads it, which in the
 * middle of a turn reads as the app hanging. Pictures are asked for explicitly now.
 *
 * The sentinel parser stays as a safety net. A model that has seen this pattern in
 * training may emit `[IMG: ...]` unprompted, and stripping it is better than showing
 * the user raw brackets.
 */

const OPEN_TAG = '[IMG:'
/** Must start a line: guards against the tag being quoted back or sitting in code. */
const STRICT_TAG = /(?:^|\n)[ \t]*\[IMG:\s*([^\]\n]{3,300})\]/g
/** Only used when the strict pass finds nothing at all. */
const LOOSE_TAG = /\[\s*img\s*[:：]\s*([^\]\n]+)\]/i
/** An unterminated tag this long is almost certainly not a tag. */
const MAX_OPEN_TAG_CHARS = 400

export interface SplitResult {
  /** The reply as the user sees and as it is stored. */
  text: string
  /** Scene descriptions, in order. Callers take the first. */
  scenes: string[]
}

export function splitPhotoTags(raw: string): SplitResult {
  const scenes: string[] = []
  let text = raw.replace(STRICT_TAG, (_match, scene: string) => {
    scenes.push(scene.trim())
    return '\n'
  })

  if (!scenes.length) {
    const loose = raw.match(LOOSE_TAG)
    if (loose?.[1]) {
      scenes.push(loose[1].trim())
      text = raw.replace(LOOSE_TAG, '')
    }
  }

  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), scenes }
}

/**
 * Longest suffix of `buffer` that might still turn into a tag: either a partial
 * `[IMG:` or a tag that has opened but not closed. Held back from the UI so the
 * sentinel never flashes mid-stream.
 */
function heldBackFrom(buffer: string): number {
  const open = buffer.lastIndexOf(OPEN_TAG)
  if (open >= 0 && !buffer.slice(open).includes(']')) {
    // Give up on a runaway tag rather than swallowing the rest of the reply.
    return buffer.length - open > MAX_OPEN_TAG_CHARS ? -1 : open
  }

  for (let len = Math.min(OPEN_TAG.length - 1, buffer.length); len > 0; len -= 1) {
    if (OPEN_TAG.startsWith(buffer.slice(buffer.length - len))) {
      return buffer.length - len
    }
  }
  return -1
}

export interface SentinelFilter {
  /** Returns the text that is safe to display right now. */
  push(token: string): string
  /** Call once the stream ends. Returns the final text and any scenes found. */
  flush(): SplitResult
}

export function createSentinelFilter(): SentinelFilter {
  let buffer = ''
  let released = 0

  return {
    push(token) {
      buffer += token
      const hold = heldBackFrom(buffer)
      const safeUpTo = hold < 0 ? buffer.length : hold
      if (safeUpTo <= released) return splitPhotoTags(buffer.slice(0, released)).text
      released = safeUpTo
      return splitPhotoTags(buffer.slice(0, released)).text
    },
    flush() {
      released = buffer.length
      return splitPhotoTags(buffer)
    },
  }
}

const SCENE_ENHANCER_SYSTEM = `You expand a short photo description into Stable Diffusion scene tags.
You are given a SUBJECT that is already fixed. Never describe the subject's face, hair, body, age, or identity.
Only expand the setting, clothing, pose, expression, lighting, time of day, camera angle and background.
Return 15-40 comma-separated tags. No sentences, no quality keywords, no explanation.`

/** Scenes shorter than this are the ones worth expanding; longer ones stand on their own. */
export const SCENE_ENHANCE_THRESHOLD = 60

export { SCENE_ENHANCER_SYSTEM }
