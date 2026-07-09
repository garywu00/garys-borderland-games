import test from "node:test";
import assert from "node:assert/strict";
import { resolveShareSteal, rankFinalists } from "../lib/game/rules";

test("Share + Share: both pairs gain 1 heart", () => {
  const o = resolveShareSteal("share", "share");
  assert.equal(o.deltaA, 1);
  assert.equal(o.deltaB, 1);
});

test("Steal + Share: stealer gains 2, sharer gains 0", () => {
  const o = resolveShareSteal("steal", "share");
  assert.equal(o.deltaA, 2);
  assert.equal(o.deltaB, 0);
});

test("Share + Steal: mirrors Steal + Share from the other side", () => {
  const o = resolveShareSteal("share", "steal");
  assert.equal(o.deltaA, 0);
  assert.equal(o.deltaB, 2);
});

test("Steal + Steal: both pairs lose 1 heart", () => {
  const o = resolveShareSteal("steal", "steal");
  assert.equal(o.deltaA, -1);
  assert.equal(o.deltaB, -1);
});

test("rankFinalists sorts by hearts descending", () => {
  const ranked = rankFinalists([
    { teamId: "a", hearts: 5, arrivalOrder: 1 },
    { teamId: "b", hearts: 9, arrivalOrder: 2 },
    { teamId: "c", hearts: 7, arrivalOrder: 3 },
  ]);
  assert.deepEqual(ranked.map((t) => t.teamId), ["b", "c", "a"]);
});

test("rankFinalists breaks heart ties by earlier arrival order", () => {
  const ranked = rankFinalists([
    { teamId: "late", hearts: 7, arrivalOrder: 3 },
    { teamId: "early", hearts: 7, arrivalOrder: 1 },
  ]);
  assert.deepEqual(ranked.map((t) => t.teamId), ["early", "late"]);
});
