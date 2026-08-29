import assert from "node:assert/strict";
import test from "node:test";

import { codeForFreeText, lineFor, POSITION_CODES, POSITIONS, positionName } from "./positions.ts";

test("every position resolves to a line and a name", () => {
  assert.equal(POSITIONS.length, 16);
  for (const position of POSITIONS) {
    assert.equal(lineFor(position.code), position.line);
    assert.equal(positionName(position.code), position.name);
  }
  assert.deepEqual([...new Set(POSITION_CODES)], [...POSITION_CODES], "codes are unique");
});

test("a keeper is the only goalkeeper, and every line is represented", () => {
  const lines = new Map<string, number>();
  for (const position of POSITIONS) lines.set(position.line, (lines.get(position.line) ?? 0) + 1);
  assert.equal(lines.get("GK"), 1);
  assert.equal(lines.get("DEF"), 5);
  assert.equal(lines.get("MID"), 5);
  assert.equal(lines.get("FWD"), 5);
});

test("wing-backs are defenders, which the free-text heuristic used to get right only by accident", () => {
  assert.equal(lineFor("LWB"), "DEF");
  assert.equal(lineFor("RWB"), "DEF");
  assert.equal(lineFor("LW"), "FWD");
});

test("an unknown code still renders and still stands somewhere", () => {
  assert.equal(positionName("XX"), "XX");
  assert.equal(lineFor("XX"), "MID");
});

test("the free-text migration covers every position written before the vocabulary", () => {
  // The five strings that appear in seed and test data.
  assert.equal(codeForFreeText("Goalkeeper"), "GK");
  assert.equal(codeForFreeText("Keeper"), "GK");
  assert.equal(codeForFreeText("Defender"), "CB");
  assert.equal(codeForFreeText("Midfielder"), "CM");
  assert.equal(codeForFreeText("Forward"), "ST");
});

test("free text already written as a code or a full name is kept exactly", () => {
  assert.equal(codeForFreeText("gk"), "GK");
  assert.equal(codeForFreeText(" LWB "), "LWB");
  assert.equal(codeForFreeText("Centre-back"), "CB");
  assert.equal(codeForFreeText("second striker"), "SS");
});

test("a line named inside longer prose lands on that line, not the one beside it", () => {
  assert.equal(codeForFreeText("Defensive midfielder"), "CM");
  assert.equal(codeForFreeText("Attacking midfielder"), "CM");
  assert.equal(codeForFreeText("Left wing-back"), "LWB");
  assert.equal(codeForFreeText("right wing back"), "RWB");
  // A name spelled without its hyphen is still that exact position, not a guess
  // at the line it belongs to: "Centre forward" is CF, never a plain striker.
  assert.equal(codeForFreeText("Centre forward"), "CF");
  assert.equal(codeForFreeText("centreback"), "CB");
  // Prose that names no position in the list still lands on the right line.
  assert.equal(codeForFreeText("Striker"), "ST");
  assert.equal(codeForFreeText("Winger"), "ST");
});

test("nothing at all becomes the most ordinary position rather than failing", () => {
  assert.equal(codeForFreeText(""), "CM");
  assert.equal(codeForFreeText("   "), "CM");
  assert.equal(codeForFreeText("utility"), "CM");
});
