// The first worksheet of an XLSX file as rows of cell strings, as openpyxl's
// load_workbook(read_only=True, data_only=True) and iter_rows(values_only=True)
// give it, each value passed through Python's str(): every row from the
// first to the last, each as wide as the sheet's dimension, empty cells as
// "". An XLSX file is a ZIP of XML files; this reads the few it needs.
import { inflateRawSync } from "node:zlib";

/** The files in a ZIP archive, by name. */
export function unzip(content: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(
    content.buffer,
    content.byteOffset,
    content.byteLength,
  );
  // the end of central directory record, within the last 64 KiB
  let end = -1;
  for (
    let i = content.length - 22;
    i >= Math.max(0, content.length - 65_557);
    i--
  ) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("not a ZIP file");
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let n = 0; n < entries; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("bad ZIP central directory");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(
      content.subarray(offset + 46, offset + 46 + nameLength),
    );
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = content.subarray(start, start + compressedSize);
    if (method === 0) files.set(name, data);
    else if (method === 8)
      files.set(name, new Uint8Array(inflateRawSync(data)));
    else throw new Error(`unsupported ZIP compression ${method} for ${name}`);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function unescapeXml(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|\w+);/g,
    (match, entity: string) => {
      if (entity.startsWith("#x"))
        return String.fromCodePoint(parseInt(entity.slice(2), 16));
      if (entity.startsWith("#"))
        return String.fromCodePoint(Number(entity.slice(1)));
      return ENTITIES[entity] ?? match;
    },
  );
}

/** The text of a shared or inline string: its <t> elements, leaving out the
 * phonetic runs (<rPh>), as openpyxl does. */
function stringText(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let text = "";
  for (const match of withoutPhonetic.matchAll(
    /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g,
  )) {
    text += unescapeXml(match[1] ?? "");
  }
  return text;
}

/** "AB12" as [row 12, column 28] (both from 1). */
function cellPosition(reference: string): [number, number] {
  const match = /^([A-Z]+)(\d+)$/.exec(reference);
  if (match === null) throw new Error(`bad cell reference ${reference}`);
  let column = 0;
  for (const letter of match[1])
    column = column * 26 + letter.charCodeAt(0) - 64;
  return [Number(match[2]), column];
}

/** A number as Python's str() writes the int or float openpyxl reads it as:
 * a float when the XML value has a ".", an "E" or an "e". */
export function pythonNumber(value: string): string {
  if (!/[.eE]/.test(value)) return String(BigInt(value));
  const number = Number(value);
  if (Number.isInteger(number) && Math.abs(number) < 1e16) return `${number}.0`;
  const abs = Math.abs(number);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e16)) {
    // Python: 1e-05, 1.5e+16
    const [mantissa, exponent] = number.toExponential().split("e");
    const sign = exponent.startsWith("-") ? "-" : "+";
    return `${mantissa}e${sign}${exponent.replace(/^[+-]/, "").padStart(2, "0")}`;
  }
  return String(number);
}

/** The first worksheet's rows. */
export function xlsxRows(content: Uint8Array): string[][] {
  const files = unzip(content);
  const read = (name: string) => {
    const file = files.get(name);
    return file === undefined ? undefined : new TextDecoder().decode(file);
  };
  const workbook = read("xl/workbook.xml");
  const relations = read("xl/_rels/workbook.xml.rels");
  if (workbook === undefined || relations === undefined)
    throw new Error("not an XLSX file");
  const firstSheet =
    /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1] ??
    /<sheet\b[^>]*\bid="([^"]+)"/.exec(workbook)?.[1];
  const target = [...relations.matchAll(/<Relationship\b[^>]*>/g)]
    .map(([tag]) => ({
      id: /\bId="([^"]+)"/.exec(tag)?.[1],
      target: /\bTarget="([^"]+)"/.exec(tag)?.[1],
    }))
    .find((relation) => relation.id === firstSheet)?.target;
  if (target === undefined) throw new Error("no first worksheet");
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const sheet = read(sheetPath);
  if (sheet === undefined) throw new Error(`no ${sheetPath}`);
  const sharedStrings = [
    ...(read("xl/sharedStrings.xml") ?? "").matchAll(
      /<si>([\s\S]*?)<\/si>|<si\/>/g,
    ),
  ].map((match) => stringText(match[1] ?? ""));

  const cells = new Map<number, Map<number, string>>();
  let maxRow = 0;
  let maxColumn = 0;
  const data =
    /<sheetData>([\s\S]*)<\/sheetData>|<sheetData\/>/.exec(sheet)?.[1] ?? "";
  for (const row of data.matchAll(
    /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g,
  )) {
    const rowNumber = Number(/\br="(\d+)"/.exec(row[1])?.[1]);
    let column = 0;
    for (const cell of (row[2] ?? "").matchAll(
      /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const attributes = cell[1];
      const reference = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1];
      column =
        reference === undefined ? column + 1 : cellPosition(reference)[1];
      const type = /\bt="(\w+)"/.exec(attributes)?.[1] ?? "n";
      const inner = cell[2] ?? "";
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value: string | null;
      if (type === "inlineStr")
        value = stringText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      else if (raw === undefined) value = null;
      else if (type === "s") value = sharedStrings[Number(raw)];
      else if (type === "str" || type === "e") value = unescapeXml(raw);
      else if (type === "b") value = raw === "1" ? "True" : "False";
      else if (type === "n") value = pythonNumber(raw);
      else value = unescapeXml(raw);
      if (value === null) continue;
      if (!cells.has(rowNumber)) cells.set(rowNumber, new Map());
      cells.get(rowNumber)!.set(column, value);
      maxRow = Math.max(maxRow, rowNumber);
      maxColumn = Math.max(maxColumn, column);
    }
    maxRow = Math.max(maxRow, rowNumber);
  }
  // openpyxl reads the sheet's size from its <dimension> when it has one
  const dimension = /<dimension\s+ref="([A-Z]+\d+)(?::([A-Z]+\d+))?"/.exec(
    sheet,
  );
  if (dimension !== null) {
    const [lastRow, lastColumn] = cellPosition(dimension[2] ?? dimension[1]);
    maxRow = lastRow;
    maxColumn = lastColumn;
  }
  const rows: string[][] = [];
  for (let r = 1; r <= maxRow; r++) {
    const row = cells.get(r);
    rows.push(
      Array.from({ length: maxColumn }, (_, c) => row?.get(c + 1) ?? ""),
    );
  }
  return rows;
}
