/**
 * Generate a short conversation title from the first user message
 * or image prompt. Strips common image-request prefixes so titles
 * read like "Cyberpunk City" instead of "Create an image of a cyberpunk city".
 */
export function generateTitle(content: string): string {
  let cleaned = content.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'New Chat'

  cleaned = cleaned.replace(
    /^(create|generate|draw|paint|make|show|render|design)\s+(an?\s+)?(image|picture|illustration|painting|photo|artwork|drawing)\s+(of\s+)?/i,
    '',
  )
  cleaned = cleaned.replace(/^(an?\s+image\s+of\s+)/i, '')
  cleaned = cleaned.trim()
  if (!cleaned) cleaned = content.replace(/\s+/g, ' ').trim()

  // Title-case short image-like prompts for nicer sidebar labels
  if (cleaned.length <= 36 && !/[.!?]$/.test(cleaned)) {
    cleaned = cleaned
      .split(' ')
      .map((w) =>
        w.length <= 2
          ? w.toLowerCase()
          : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      )
      .join(' ')
  }

  if (cleaned.length <= 42) return cleaned
  const truncated = cleaned.slice(0, 42)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '…'
}
