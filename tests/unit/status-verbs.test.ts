import assert from "node:assert/strict";
import test from "node:test";
import { STATUS_VERB_SETS, pickRandomVerb, resetStatusVerbRotation } from "../../lib/status-verbs";

test("three sets exist with 20 verbs each (EN + ES)", () => {
  assert.equal(STATUS_VERB_SETS.length, 3);
  for (const setId of ["clarifying", "thinking", "making"]) {
    const set = STATUS_VERB_SETS.find((s) => s.id === setId);
    assert.ok(set, `${setId} set exists`);
    assert.equal(set.verbs.length, 20, `${setId} EN has 20 verbs`);
    assert.equal(set.verbsEs.length, 20, `${setId} ES has 20 verbs`);
    assert.ok(new Set(set.verbs).size === 20, `${setId} EN verbs are unique`);
    assert.ok(new Set(set.verbsEs).size === 20, `${setId} ES verbs are unique`);
  }
});

test("pickRandomVerb returns only verbs from the requested set+language", () => {
  for (const setId of ["clarifying", "thinking", "making"] as const) {
    for (const lang of ["en", "es"] as const) {
      for (let i = 0; i < 50; i++) {
        const v = pickRandomVerb(setId, lang);
        const set = STATUS_VERB_SETS.find((s) => s.id === setId)!;
        const pool = lang === "es" ? set.verbsEs : set.verbs;
        assert.ok(pool.includes(v), `${setId}/${lang}: "${v}" in pool`);
      }
    }
  }
});

test("pickRandomVerb never repeats the previous verb", () => {
  let prev: string | null = null;
  for (let i = 0; i < 100; i++) {
    const v = pickRandomVerb("thinking", "en", prev);
    assert.notEqual(v, prev, `no immediate repeat (got "${v}" after "${prev}")`);
    prev = v;
  }
});

test("pickRandomVerb exhausts the set before repeating (fair rotation)", () => {
  // Fair rotation: within one full cycle of 20 picks starting from a fresh
  // queue, every verb appears exactly once. The queue is shared module state
  // across tests, so reset it first to test the cycle invariant cleanly.
  resetStatusVerbRotation();
  const seen = new Set<string>();
  let prev: string | null = null;
  for (let i = 0; i < 20; i++) {
    const v = pickRandomVerb("making", "en", prev);
    seen.add(v);
    prev = v;
  }
  assert.equal(seen.size, 20, "all 20 verbs appear within one fresh cycle");

  // Boundary invariant: the first pick of the next cycle must not repeat the
  // last pick of the previous cycle.
  const lastOfCycle = prev;
  const firstOfNext = pickRandomVerb("making", "en", lastOfCycle);
  assert.notEqual(firstOfNext, lastOfCycle, "no repeat across a refill boundary");
});
