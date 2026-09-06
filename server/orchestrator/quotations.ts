/** Quote matching is a text check, not validation of the model's interpretation. */
export function normalizeQuote(value: string): string {
  return value.toLowerCase().replace(/[‘’‚‛`´]/g, "'")
    .replace(/[“”„‟«»]/g, '"').replace(/[–—−]/g, "-")
    .replace(/[   ]/g, " ").replace(/[*_`]+/g, "")
    .replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim();
}

export function extractQuotedPassages(value: string): string[] {
  const passages: string[] = [];
  for (const pattern of [
    /"([^"]+)"/g, /“([^”]+)”/g, /«([^»]+)»/g, /‹([^›]+)›/g,
    /‘([^’]+)’/g,
    // Do not interpret ordinary apostrophes in contractions as quotations.
    /(?<![\p{L}\p{N}])'([^']+)'(?![\p{L}\p{N}])/gu,
  ]) {
    for (const match of value.matchAll(pattern)) {
      if (normalizeQuote(match[1])) passages.push(match[1]);
    }
  }
  return passages;
}

export function allQuotesMatch(value: string, passage: string): boolean {
  const quotes = extractQuotedPassages(value);
  const retained = normalizeQuote(passage);
  return quotes.length > 0 && quotes.every(quote => retained.includes(normalizeQuote(quote)));
}
