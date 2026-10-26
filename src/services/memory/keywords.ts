/**
 * Keyword extraction for embedding-free recall.
 *
 * Deliberately computed locally rather than asked of the model: it is deterministic,
 * free, and never hallucinates a keyword that isn't in the text.
 */

const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been
   before being below between both but by can cannot could couldn't did didn't do does
   doesn't doing don't down during each few for from further had hadn't has hasn't have
   haven't having he her here hers herself him himself his how i if in into is isn't it
   its itself just me more most my myself no nor not of off on once only or other ought
   our ours ourselves out over own same shan't she should shouldn't so some such than
   that the their theirs them themselves then there these they this those through to too
   under until up very was wasn't we were weren't what when where which while who whom
   why with won't would wouldn't you your yours yourself yourselves will im ive youre
   thats dont cant really quite thing things lot bit much many get got going gonna know
   think feel like want need say said tell told talk going yeah okay ok well right sure
   maybe actually probably always never sometimes today tomorrow yesterday now then`
    .split(/\s+/)
    .filter(Boolean),
)

const MAX_KEYWORDS = 12

export function extractKeywords(text: string, max = MAX_KEYWORDS): string[] {
  const seen = new Set<string>()
  const words: string[] = []

  for (const raw of (text ?? '').toLowerCase().split(/[^a-z0-9'-]+/)) {
    const word = raw.replace(/^[''-]+|[''-]+$/g, '')
    if (word.length < 3 || STOPWORDS.has(word) || seen.has(word)) continue
    seen.add(word)
    words.push(word)
    if (words.length >= max) break
  }

  return words
}

export function keywordString(text: string): string {
  return extractKeywords(text).join(' ')
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let shared = 0
  for (const x of setA) if (setB.has(x)) shared += 1
  return shared / (setA.size + setB.size - shared)
}

function trigrams(text: string): Set<string> {
  const normalized = ` ${text.toLowerCase().replace(/\s+/g, ' ').trim()} `
  const out = new Set<string>()
  for (let i = 0; i + 3 <= normalized.length; i += 1) {
    out.add(normalized.slice(i, i + 3))
  }
  return out
}

/** Character-level similarity, for near-duplicates that share few whole words. */
export function diceSimilarity(a: string, b: string): number {
  const ta = trigrams(a)
  const tb = trigrams(b)
  if (!ta.size || !tb.size) return 0
  let shared = 0
  for (const g of ta) if (tb.has(g)) shared += 1
  return (2 * shared) / (ta.size + tb.size)
}

export function normalizeFact(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/\.$/, '')
}
