import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { minutesFromEvents } from "./match-minutes.ts";

const starter = (id: string) => ({ player_id: id, is_starter: 1 });
const bench = (id: string) => ({ player_id: id, is_starter: 0 });
const sub = (minute: number | null, on: string, off: string) =>
  ({ type: "substitution", minute, player_id: on, secondary_player_id: off });
const red = (minute: number | null, player: string) =>
  ({ type: "red_card", minute, player_id: player, secondary_player_id: null });

/**
 * Minutes are read off the team sheet and the thread of events, for the length
 * this match was actually set to run. Every rule here is one a coach would
 * state out loud about a real game.
 */
describe("minutes played", () => {
  it("gives a starter who is never taken off the whole match", () => {
    const played = minutesFromEvents([starter("a")], [], 60);
    assert.equal(played.get("a"), 60);
  });

  it("stops a starter's clock when she is substituted off", () => {
    const played = minutesFromEvents([starter("a"), bench("b")], [sub(35, "b", "a")], 60);
    assert.equal(played.get("a"), 35);
    assert.equal(played.get("b"), 25);
  });

  it("gives a substitute who never came on a nought", () => {
    const played = minutesFromEvents([starter("a"), bench("b")], [], 60);
    assert.equal(played.get("b"), 0);
  });

  it("counts a substitute who came on and went off again", () => {
    const played = minutesFromEvents([bench("b"), starter("a"), starter("c")], [sub(10, "b", "a"), sub(40, "c", "b")], 60);
    assert.equal(played.get("b"), 30);
  });

  // Sent off is off, whether or not anybody replaced her.
  it("ends a sent-off player's match at the card", () => {
    const played = minutesFromEvents([starter("a")], [red(22, "a")], 90);
    assert.equal(played.get("a"), 22);
  });

  it("ends it at the card for a substitute too", () => {
    const played = minutesFromEvents([bench("b"), starter("a")], [sub(10, "b", "a"), red(25, "b")], 90);
    assert.equal(played.get("b"), 15);
  });

  /**
   * The academy's own matches are not ninety minutes, and a test match's events
   * land at minute 1. Both have to come out as themselves rather than as a
   * default nobody chose.
   */
  it("works to the match's own length, however short", () => {
    const short = minutesFromEvents([starter("a"), bench("b")], [sub(1, "b", "a")], 2);
    assert.equal(short.get("a"), 1);
    assert.equal(short.get("b"), 1);

    const long = minutesFromEvents([starter("a")], [], 120);
    assert.equal(long.get("a"), 120);
  });

  // A minute nobody recorded cannot be arithmetic. Guessing one would put a
  // number on the report that no event in the match supports.
  it("ignores an event with no minute rather than guessing", () => {
    const played = minutesFromEvents([starter("a"), bench("b")], [sub(null, "b", "a")], 60);
    assert.equal(played.get("a"), 60);
    assert.equal(played.get("b"), 0);
  });

  // A correction can leave the thread saying she came off before she came on.
  it("never returns a negative", () => {
    const played = minutesFromEvents([bench("b"), starter("a")], [sub(40, "b", "a"), red(10, "b")], 60);
    assert.equal(played.get("b"), 0);
  });

  it("holds a substitution past full time to the final whistle", () => {
    const played = minutesFromEvents([starter("a"), bench("b")], [sub(95, "b", "a")], 60);
    assert.equal(played.get("a"), 60);
    assert.equal(played.get("b"), 0);
  });
});
