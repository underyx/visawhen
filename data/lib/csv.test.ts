import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeText, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("reads quoted fields with commas, newlines and doubled quotes", () => {
    assert.deepEqual(parseCsv('a,"b, c","say ""hi""\nthere"\r\n1,2,3\n'), [
      ["a", "b, c", 'say "hi"\nthere'],
      ["1", "2", "3"],
    ]);
  });

  it("keeps a quote inside an unquoted field and reads an empty line as an empty row", () => {
    assert.deepEqual(parseCsv('5" pipe,x\n\n,\n'), [
      ['5" pipe', "x"],
      [],
      ["", ""],
    ]);
  });

  it("reads a last line without a newline", () => {
    assert.deepEqual(parseCsv("a,b"), [["a", "b"]]);
  });
});

describe("decodeText", () => {
  it("reads UTF-8 without its byte order mark", () => {
    assert.equal(
      decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x46, 0xc3, 0xa9])),
      "Fé",
    );
  });

  it("falls back to Windows-1252", () => {
    assert.equal(
      decodeText(new Uint8Array([0x46, 0x69, 0x61, 0x6e, 0x63, 0xe9])),
      "Fiancé",
    );
  });
});
