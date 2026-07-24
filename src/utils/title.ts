/** Generate a short conversation title from the first user message */
export function generateTitle(content: string): string {
  const cleaned = content.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'New Chat'
  if (cleaned.length <= 42) return cleaned
  const truncated = cleaned.slice(0, 42)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '…'
}
