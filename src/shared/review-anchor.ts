export interface ReviewQuoteRange {
  from: number
  to: number
}

/**
 * Finds a review quote only when its occurrence is unambiguous, unless the
 * review supplied an explicit one-based occurrence number.
 */
export function locateReviewQuote(content: string, quote: string, occurrence?: number): ReviewQuoteRange | null {
  if (!quote) return null
  const matches: number[] = []
  let offset = 0
  while (offset <= content.length) {
    const found = content.indexOf(quote, offset)
    if (found < 0) break
    matches.push(found)
    offset = found + Math.max(1, quote.length)
  }
  const index = occurrence === undefined ? (matches.length === 1 ? 0 : -1) : occurrence - 1
  const from = index >= 0 ? matches[index] : undefined
  return from === undefined ? null : { from, to: from + quote.length }
}
