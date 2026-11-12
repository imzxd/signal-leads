/**
 * Split a knowledge document into retrieval-sized chunks.
 * FAQ-formatted content keeps each Q/A pair intact; prose is packed by paragraph
 * with a small overlap so answers that span a boundary stay retrievable.
 */
export interface TextChunk {
  index: number;
  content: string;
  tokenEstimate: number;
}

const TARGET = 700;
const OVERLAP = 120;

export function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkDocument(title: string, raw: string): TextChunk[] {
  const text = cleanText(raw);
  if (!text) return [];
  const faqPairs = text.match(/Q:[\s\S]+?A:[\s\S]+?(?=\n\s*Q:|$)/g);
  const units = faqPairs && faqPairs.length >= 2 ? faqPairs.map((p) => p.trim()) : text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    if (unit.length > TARGET * 1.6) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      const sentences = unit.split(/(?<=[.!?])\s+/);
      let buf = "";
      for (const s of sentences) {
        if ((buf + " " + s).length > TARGET && buf) {
          chunks.push(buf.trim());
          buf = buf.slice(-OVERLAP);
        }
        buf += ` ${s}`;
      }
      if (buf.trim()) chunks.push(buf.trim());
      continue;
    }
    if (current && (current + "\n\n" + unit).length > TARGET) {
      chunks.push(current);
      current = faqPairs ? "" : current.slice(-OVERLAP);
    }
    current = current ? `${current}\n\n${unit}` : unit;
  }
  if (current.trim()) chunks.push(current.trim());

  // Prefix the title so short chunks keep their context for both embeddings and FTS.
  return chunks.map((c, index) => {
    const content = `${title}\n${c}`;
    return { index, content, tokenEstimate: Math.ceil(content.length / 4) };
  });
}
