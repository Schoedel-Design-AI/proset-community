import assert from "node:assert/strict";
import test from "node:test";

import { resolveVerificationOutcome } from "../../lib/verification-outcome";

test("a verified click with no session lands on sign-in, not on an expiry error", () => {
  assert.equal(
    resolveVerificationOutcome({ actionApplied: true, hasSession: false, emailVerified: false }),
    "sign-in",
  );
});

test("a verified click with a verified session goes into the app", () => {
  assert.equal(
    resolveVerificationOutcome({ actionApplied: true, hasSession: true, emailVerified: true }),
    "home",
  );
});

test("a session that is still unverified stays on the verify screen", () => {
  assert.equal(
    resolveVerificationOutcome({ actionApplied: true, hasSession: true, emailVerified: false }),
    "stay",
  );
});

test("an unapplied action code never navigates", () => {
  for (const hasSession of [true, false]) {
    for (const emailVerified of [true, false]) {
      assert.equal(
        resolveVerificationOutcome({ actionApplied: false, hasSession, emailVerified }),
        "stay",
      );
    }
  }
});
