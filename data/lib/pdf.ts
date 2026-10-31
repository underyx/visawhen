// Text out of PDFs, with pdf.js (through unpdf, which bundles a build of it
// with no canvas dependency).
import { getDocumentProxy } from "unpdf";

export interface Word {
  text: string;
  x0: number;
  x1: number;
  // distance of the glyphs' top from the top of the page
  top: number;
  // the baseline's distance from the bottom of the page
  baseline: number;
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  fontName: string;
  hasEOL: boolean;
}

/** The text pieces of each page as pdf.js reports them, each with its box. */
export async function pdfPages(content: Uint8Array): Promise<Word[][]> {
  // pdf.js takes ownership of the buffer it is given
  const pdf = await getDocumentProxy(content.slice(), { verbosity: 0 });
  const pages: Word[][] = [];
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const height = page.getViewport({ scale: 1 }).height;
      const text = await page.getTextContent();
      const pieces: Word[] = [];
      for (const item of text.items as TextItem[]) {
        if (!("str" in item) || item.str === "") continue;
        const [a, b, , d, x, y] = item.transform;
        const size = Math.hypot(a, b) || Math.abs(d);
        const descent =
          (text.styles[item.fontName] as { descent?: number } | undefined)
            ?.descent ?? -0.25;
        pieces.push({
          text: item.str,
          x0: x,
          x1: x + item.width,
          // as pdfminer boxes a glyph: from the descent to a font size above it
          top: height - (y + descent * size + size),
          baseline: y,
        });
      }
      pages.push(pieces);
      page.cleanup();
    }
  } finally {
    await pdf.cleanup();
  }
  return pages;
}

/** The words of a page as pdfplumber's extract_words() finds them: pieces
 * split into characters (pdf.js gives no per-glyph positions, so a piece's
 * width is shared out evenly), clustered into lines by their top within 3
 * points, sorted left to right, and split into words at whitespace, at a gap
 * of more than 3 points, or where a character starts left of the one before. */
export function plumberWords(pieces: Word[]): Word[] {
  const tolerance = 3;
  const chars: Word[] = pieces.flatMap((piece) => {
    const glyphs = [...piece.text];
    const width = (piece.x1 - piece.x0) / glyphs.length;
    return glyphs.map((glyph, i) => ({
      text: glyph,
      x0: piece.x0 + i * width,
      x1: piece.x0 + (i + 1) * width,
      top: piece.top,
      baseline: piece.baseline,
    }));
  });
  // cluster_objects: tops sorted, a new cluster where the gap exceeds the tolerance
  const tops = [...new Set(chars.map((char) => char.top))].sort(
    (a, b) => a - b,
  );
  const clusterOf = new Map<number, number>();
  let cluster = -1;
  let last = -Infinity;
  for (const top of tops) {
    if (top - last > tolerance) cluster++;
    clusterOf.set(top, cluster);
    last = top;
  }
  const lines = new Map<number, Word[]>();
  for (const char of chars) {
    const key = clusterOf.get(char.top)!;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key)!.push(char);
  }
  const words: Word[] = [];
  for (const key of [...lines.keys()].sort((a, b) => a - b)) {
    const line = lines.get(key)!.sort((a, b) => a.x0 - b.x0);
    let word: Word[] = [];
    const flush = () => {
      if (word.length === 0) return;
      words.push({
        text: word.map((char) => char.text).join(""),
        x0: Math.min(...word.map((char) => char.x0)),
        x1: Math.max(...word.map((char) => char.x1)),
        top: Math.min(...word.map((char) => char.top)),
        baseline: word[0].baseline,
      });
      word = [];
    };
    for (const char of line) {
      if (/^\s$/.test(char.text)) {
        flush();
        continue;
      }
      const previous = word.at(-1);
      if (
        previous !== undefined &&
        (char.x0 < previous.x0 ||
          char.x0 > previous.x1 + tolerance ||
          Math.abs(char.top - previous.top) > tolerance)
      ) {
        flush();
      }
      word.push(char);
    }
    flush();
  }
  return words;
}
