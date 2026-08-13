import assert from "node:assert/strict";
import test from "node:test";

import {
  decideInterruption,
  parseSnapshot,
  serializeSnapshot,
  SNAPSHOT_MAX_AGE_MS,
  type ActiveRecordingSnapshot,
} from "../../lib/active-recording-recovery";

const baseSnapshot: ActiveRecordingSnapshot = {
  v: 1,
  startedAt: 1_700_000_000_000,
  phase: "recording",
  userId: "user-1",
};

test("serialize → parse round-trips", () => {
  const raw = serializeSnapshot(baseSnapshot);
  assert.deepEqual(parseSnapshot(raw), baseSnapshot);
});

test("parseSnapshot returns null for empty, malformed, or unknown shapes", () => {
  assert.equal(parseSnapshot(null), null);
  assert.equal(parseSnapshot(""), null);
  assert.equal(parseSnapshot("not-json"), null);
  assert.equal(parseSnapshot("[]"), null);
  assert.equal(parseSnapshot(JSON.stringify({ ...baseSnapshot, v: 2 })), null);
  assert.equal(parseSnapshot(JSON.stringify({ ...baseSnapshot, phase: "idle" })), null);
  assert.equal(parseSnapshot(JSON.stringify({ ...baseSnapshot, startedAt: "x" })), null);
});

test("decideInterruption: no snapshot → no-op", () => {
  assert.deepEqual(
    decideInterruption(null, "user-1", baseSnapshot.startedAt + 1000),
    { interrupted: false, shouldClear: false },
  );
});

test("decideInterruption: snapshot from another user is cleared without surfacing", () => {
  assert.deepEqual(
    decideInterruption(baseSnapshot, "user-2", baseSnapshot.startedAt + 1000),
    { interrupted: false, shouldClear: true },
  );
});

test("decideInterruption: stale snapshot is cleared without surfacing", () => {
  assert.deepEqual(
    decideInterruption(
      baseSnapshot,
      "user-1",
      baseSnapshot.startedAt + SNAPSHOT_MAX_AGE_MS + 1,
    ),
    { interrupted: false, shouldClear: true },
  );
});

test("decideInterruption: snapshot with future startedAt is treated as stale", () => {
  assert.deepEqual(
    decideInterruption(baseSnapshot, "user-1", baseSnapshot.startedAt - 1000),
    { interrupted: false, shouldClear: true },
  );
});

test("decideInterruption: recent same-user snapshot surfaces and clears once", () => {
  assert.deepEqual(
    decideInterruption(baseSnapshot, "user-1", baseSnapshot.startedAt + 60_000),
    { interrupted: true, shouldClear: true },
  );
});

test("decideInterruption: anonymous user matches null-owned snapshot", () => {
  const anon: ActiveRecordingSnapshot = { ...baseSnapshot, userId: null };
  assert.deepEqual(
    decideInterruption(anon, null, anon.startedAt + 1000),
    { interrupted: true, shouldClear: true },
  );
});
