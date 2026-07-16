import test from "node:test";
import assert from "node:assert/strict";
import { checkTriviaAnswer, TRIVIA_QUESTIONS } from "../lib/game/trivia";

test("all 6 trivia questions are present with unique ids", () => {
  assert.equal(TRIVIA_QUESTIONS.length, 6);
  const ids = new Set(TRIVIA_QUESTIONS.map((q) => q.id));
  assert.equal(ids.size, 6);
});

test("exact match is accepted", () => {
  assert.equal(checkTriviaAnswer("survivor", "Survivor"), true);
});

test("whitespace and case are normalized", () => {
  assert.equal(checkTriviaAnswer("orange", "  ORANGE  "), true);
});

test("accepted variants all match", () => {
  assert.equal(checkTriviaAnswer("eggs_benedict", "egg benedict"), true);
  assert.equal(checkTriviaAnswer("five", "five"), true);
  assert.equal(checkTriviaAnswer("five", "5"), true);
  assert.equal(checkTriviaAnswer("cooking", "food content"), true);
});

test("wrong answer is rejected", () => {
  assert.equal(checkTriviaAnswer("survivor", "the bachelor"), false);
});

test("unknown question id is rejected", () => {
  assert.equal(checkTriviaAnswer("not_a_real_question", "anything"), false);
});
