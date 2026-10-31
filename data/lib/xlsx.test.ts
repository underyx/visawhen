import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pythonNumber, xlsxRows } from "./xlsx";

/** A ZIP archive of uncompressed files (no checksums: the reader does not
 * check them). */
function zip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  const u16 = (n: number) => [n & 0xff, n >> 8];
  const u32 = (n: number) => [
    n & 0xff,
    (n >> 8) & 0xff,
    (n >> 16) & 0xff,
    n >>> 24,
  ];
  const names = Object.keys(files);
  for (const name of names) {
    const nameBytes = [...encoder.encode(name)];
    const data = [...encoder.encode(files[name])];
    const offset = local.length;
    local.push(
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
    );
    local.push(
      ...u32(0),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
    );
    local.push(...nameBytes, ...data);
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
    );
    central.push(
      ...u32(0),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
    );
    central.push(
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...nameBytes,
    );
  }
  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(names.length),
    ...u16(names.length),
    ...u32(central.length),
    ...u32(local.length),
    ...u16(0),
  ];
  return new Uint8Array([...local, ...central, ...end]);
}

describe("pythonNumber", () => {
  it("writes numbers as Python's str() writes the int or float openpyxl reads", () => {
    assert.equal(pythonNumber("1234"), "1234");
    assert.equal(pythonNumber("8"), "8");
    assert.equal(pythonNumber("8.0"), "8.0");
    assert.equal(pythonNumber("59172.344"), "59172.344");
    assert.equal(pythonNumber("1E3"), "1000.0");
    assert.equal(pythonNumber("0.00001"), "1e-05");
  });
});

describe("xlsxRows", () => {
  it("reads the first sheet's cells, shared strings without their phonetic runs, padded to the sheet's size", () => {
    const content = zip({
      "xl/workbook.xml":
        '<workbook><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="worksheet"/></Relationships>',
      "xl/sharedStrings.xml":
        '<sst><si><t>Form &amp; Title</t></si><si><r><t>Fianc</t></r><r><t xml:space="preserve">é(e)</t></r><rPh><t>x</t></rPh></si></sst>',
      "xl/worksheets/sheet1.xml":
        '<worksheet><dimension ref="A1:C3"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
        '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><v>12.5</v></c><c r="C3" t="b"><v>1</v></c></row></sheetData></worksheet>',
    });
    assert.deepEqual(xlsxRows(content), [
      ["Form & Title", "", ""],
      ["", "", ""],
      ["Fiancé(e)", "12.5", "True"],
    ]);
  });
});
