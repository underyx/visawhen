import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalize, rankPlace } from "./search";

describe("normalize", () => {
  it("strips accents, case and punctuation", () => {
    assert.equal(normalize("São Paulo"), "saopaulo");
    assert.equal(normalize("sao paulo"), "saopaulo");
    assert.equal(normalize("I-485"), "i485");
  });
});

describe("rankPlace", () => {
  const sanFrancisco = (typed: string) =>
    rankPlace(typed, ["San Francisco"], ["CA", "California"]);

  it("finds a place by the start of a word, whole words first", () => {
    assert.equal(sanFrancisco("fran"), 1);
    assert.equal(sanFrancisco("francisco"), 0);
    assert.equal(sanFrancisco("san fran"), 1);
    assert.equal(sanFrancisco("sanfrancisco"), 0);
    assert.equal(sanFrancisco("ciscoca"), null);
  });

  it("runs on from the name into the region, and finds the region alone", () => {
    assert.equal(sanFrancisco("francisco ca"), 0);
    assert.equal(sanFrancisco("ca"), 0);
    assert.equal(sanFrancisco("california"), 0);
    assert.equal(rankPlace("tx", ["Houston"], ["TX", "Texas"]), 0);
    assert.equal(rankPlace("houston tx", ["Houston"], ["TX", "Texas"]), 0);
    assert.equal(rankPlace("ca", ["Charlotte"], ["NC", "North Carolina"]), 1);
  });

  it("finds a name of two or more words by its initials", () => {
    assert.equal(sanFrancisco("sf"), 0);
    assert.equal(rankPlace("slc", ["Salt Lake City"], ["UT"]), 0);
    assert.equal(rankPlace("sl", ["Salt Lake City"], ["UT"]), 1);
    assert.equal(rankPlace("sf", ["Fort Myers"], ["FL", "Florida"]), null);
    assert.equal(rankPlace("sf", ["Stamford"], ["CT"]), null);
  });

  it("uses the other names a place goes by, and takes the best rank", () => {
    assert.equal(rankPlace("bombay", ["Mumbai", "Bombay"], [null]), 0);
    assert.equal(rankPlace("mum", ["Mumbai", "Bombay"], [null]), 1);
  });

  it("ranks everything first when nothing is typed", () => {
    assert.equal(rankPlace("", ["Anywhere"], []), 0);
    assert.equal(rankPlace(" - ", ["Anywhere"], []), 0);
  });
});
