/** Rows of a CSV text, read as Python's csv.reader() reads them: fields split
 * on commas, quoted fields may hold commas, newlines and doubled quotes, a
 * quote inside an unquoted field is kept as it is, and an empty line is an
 * empty row. Lines end in \r\n, \n or \r. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  // whether the current line has a field yet: an empty line is an empty row
  let inRow = false;
  let quoted = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    if (inRow) endField();
    rows.push(row);
    row = [];
    inRow = false;
  };
  while (i < text.length) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += char;
      }
      i++;
      continue;
    }
    if (char === '"' && field === "" && !fieldStarted(text, i)) {
      quoted = true;
      inRow = true;
    } else if (char === ",") {
      inRow = true;
      endField();
    } else if (char === "\r" || char === "\n") {
      endRow();
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else {
      inRow = true;
      field += char;
    }
    i++;
  }
  if (inRow || field !== "") endRow();
  return rows;
}

/** Whether a quote at i comes after other characters of its field (then it is
 * an ordinary character, as in csv.reader), rather than opening it. */
function fieldStarted(text: string, i: number): boolean {
  const previous = text[i - 1];
  return i > 0 && previous !== "," && previous !== "\n" && previous !== "\r";
}

/** A CSV file's text: UTF-8 (with or without a byte order mark), or else
 * Windows-1252, which Excel writes. */
export function decodeText(content: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return new TextDecoder("windows-1252").decode(content);
  }
}
