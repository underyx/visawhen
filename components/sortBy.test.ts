import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sortBy } from "./sortBy";

describe("sortBy", () => {
  it("sorts by each key in turn", () => {
    const rows = [
      { name: "b", n: 2 },
      { name: "a", n: 2 },
      { name: "c", n: 1 },
    ];
    assert.deepEqual(
      sortBy(
        rows,
        ({ n }) => n,
        ({ name }) => name,
      ).map(({ name }) => name),
      ["c", "a", "b"],
    );
  });

  it("sorts numbers as numbers and strings by character code", () => {
    assert.deepEqual(
      sortBy([10, 9, 100], (n) => n),
      [9, 10, 100],
    );
    assert.deepEqual(
      sortBy(["b", "a", "B"], (s) => s),
      ["B", "a", "b"],
    );
  });

  it("keeps the order of items with the same keys and leaves the input as it is", () => {
    const rows = ["x2", "y1", "x1"];
    assert.deepEqual(
      sortBy(rows, (s) => s[0]),
      ["x2", "x1", "y1"],
    );
    assert.deepEqual(rows, ["x2", "y1", "x1"]);
  });
});
