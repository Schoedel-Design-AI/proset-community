import assert from "node:assert/strict";
import test from "node:test";

import { resolveGoogleServiceRowAction } from "../../lib/google-service-row";

const work = { id: "acct-work", services: ["identity", "drive", "docs", "sheets", "slides"] };
const personal = { id: "acct-personal", services: ["identity", "drive", "tasks"] };

test("an unassigned service with a capable account is assigned, not re-authorized", () => {
  const action = resolveGoogleServiceRowAction([work, personal], {}, "tasks");
  assert.deepEqual(action, { kind: "setDefault", accountId: "acct-personal" });
});

test("an unassigned service nobody covers asks for its permission on the first connection", () => {
  // The old behavior assigned the account silently and left the row showing a
  // permission mark the user had not caused; the tap must start the grant.
  const action = resolveGoogleServiceRowAction([work, personal], {}, "calendar");
  assert.deepEqual(action, { kind: "requestScope", accountId: "acct-work" });
});

test("an unassigned service with no connections opens the add-account flow", () => {
  assert.deepEqual(resolveGoogleServiceRowAction([], {}, "calendar"), { kind: "requestScope" });
});

test("a default that lacks the permission hands over to an account that has it", () => {
  const action = resolveGoogleServiceRowAction([work, personal], { tasks: "acct-work" }, "tasks");
  assert.deepEqual(action, { kind: "setDefault", accountId: "acct-personal" });
});

test("a default that lacks the permission and is the only connection asks Google for it", () => {
  const action = resolveGoogleServiceRowAction([work], { calendar: "acct-work" }, "calendar");
  assert.deepEqual(action, { kind: "requestScope", accountId: "acct-work" });
});

test("a served service cycles through the accounts, then off, then back", () => {
  const first = resolveGoogleServiceRowAction([work, personal], { drive: "acct-work" }, "drive");
  assert.deepEqual(first, { kind: "setDefault", accountId: "acct-personal" });

  const second = resolveGoogleServiceRowAction([work, personal], { drive: "acct-personal" }, "drive");
  assert.deepEqual(second, { kind: "setDefault", accountId: null });

  const third = resolveGoogleServiceRowAction([work, personal], {}, "drive");
  assert.equal(third.kind, "setDefault");
});

test("a default pointing at a removed account is treated as unassigned", () => {
  const action = resolveGoogleServiceRowAction([work], { tasks: "acct-gone" }, "tasks");
  assert.deepEqual(action, { kind: "requestScope", accountId: "acct-work" });
});

test("a single served account still cycles to unassigned and back to the account", () => {
  assert.deepEqual(
    resolveGoogleServiceRowAction([work], { drive: "acct-work" }, "drive"),
    { kind: "setDefault", accountId: null }
  );
  assert.deepEqual(
    resolveGoogleServiceRowAction([work], {}, "drive"),
    { kind: "setDefault", accountId: "acct-work" }
  );
});
