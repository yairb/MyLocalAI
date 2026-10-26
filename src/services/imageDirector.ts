/**
 * Lets a character decide, mid-reply, to send a photo of itself.
 *
 * The model marks it with an inline sentinel rather than an OpenAI tool call: tool
 * calling depends on the GGUF's chat template having a tools branch, which most
 * roleplay finetunes don't, and the structured mode visibly flattens the prose. The
 * sentinel also carries *what* the photo shows, which a yes/no classifier pass can't.
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

export const PHOTO_INSTRUCTIONS = (char: string, user: string): string =>
  `# SENDING PHOTOS
You have a phone and you can send ${user} a photo of yourself.

To send one, write this on its own line at the end of your reply:
[IMG: what the photo shows]

Describe only what is visible in the photo — where you are, what you are wearing, your pose and expression, the light, the time of day. Write it as a photo caption, not as a sentence to ${user}.
Do not describe your face, hair, body or age: that is already known.

Example:
Still stuck at the office, it's awful. *holds up the phone* Look at this view though.
[IMG: standing by a floor-to-ceiling office window at dusk, city lights below, grey blazer, tired smile, phone raised in the reflection]

Send a photo only when it is natural — ${user} asked to see something, or you are somewhere or doing something worth showing. Most replies have no photo. Never send two in a row. Never mention the brackets, and never say that you cannot send pictures. You are ${char}; you have a camera like anyone else.`

const REQUEST_VERBS =
  /\b(send|show|share|take|snap|post|give)\b.*\b(pic|pics|picture|photo|photos|selfie|selfies|image|shot)\b/i
const APPEARANCE_QUESTION =
  /\b(what|how)\b.*\b(you|u)\b.*\b(look|looks|looking)\b|\blet me see\b|\bsee you\b|\bsend me one\b/i

/**
 * Whether the user is plainly asking to see the character. Small models often answer
 * "sure, here you go!" without emitting the tag, so this triggers a one-off nudge.
 */
export function looksLikeImageRequest(text: string): boolean {
  const t = text.trim()
  if (t.length > 300) return false
  return REQUEST_VERBS.test(t) || APPEARANCE_QUESTION.test(t)
}

export const IMAGE_REQUEST_NUDGE = (user: string): string =>
  `${user} is asking to see you. Reply in character and end your reply with an [IMG: ...] line describing the photo you send.`

const SCENE_ENHANCER_SYSTEM = `You expand a short photo description into Stable Diffusion scene tags.
You are given a SUBJECT that is already fixed. Never describe the subject's face, hair, body, age, or identity.
Only expand the setting, clothing, pose, expression, lighting, time of day, camera angle and background.
Return 15-40 comma-separated tags. No sentences, no quality keywords, no explanation.`

/** Scenes shorter than this are the ones worth expanding; longer ones stand on their own. */
export const SCENE_ENHANCE_THRESHOLD = 60

export { SCENE_ENHANCER_SYSTEM }
