import assert from "node:assert/strict";
import test from "node:test";

import {
  RESEND_COOLDOWN_MS,
  requestPasswordResetLink,
  resendCooldownRemaining,
  webmailFor,
} from "../../lib/password-reset";

test("the resend cooldown counts down and then releases", () => {
  const now = 1_000_000;

  assert.equal(resendCooldownRemaining(null, now), 0, "no request yet = resend allowed");
  assert.equal(resendCooldownRemaining(now - RESEND_COOLDOWN_MS, now), 0, "exactly at the end = allowed");
  assert.equal(resendCooldownRemaining(now - 1_000, now), 59);
  assert.equal(resendCooldownRemaining(now - 59_500, now), 1, "a partial second still blocks");
  assert.equal(resendCooldownRemaining(now - 30_000, now, 60_000), 30);
});

test("webmailFor names the providers we can actually send someone to", () => {
  assert.deepEqual(webmailFor("jenny@gmail.com"), { url: "https://mail.google.com/", label: "Gmail" });
  assert.equal(webmailFor("  J.Pacheco@Outlook.COM  ")?.url, "https://outlook.live.com/mail/");
  assert.equal(webmailFor("x@me.com")?.url, "https://www.icloud.com/mail");
  assert.equal(webmailFor("x@yahoo.com")?.label, "Yahoo Mail");

  // Custom / company domains: we cannot know which host serves them, and a guess
  // is worse than leaving the user to open their own mailbox.
  assert.equal(webmailFor("barry@schoedeldesign.ai"), null);
  assert.equal(webmailFor("someone@example.com"), null);
  assert.equal(webmailFor("not-an-email"), null);
});

function withStubbedFetch(stub: unknown, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("requestPasswordResetLink posts the lowercased address and reports success", async () => {
  let seenUrl = "";
  let seenBody: { email?: string } = {};
  await withStubbedFetch(
    async (url: string, init: { body?: string }) => {
      seenUrl = String(url);
      seenBody = JSON.parse(init.body ?? "{}");
      return { ok: true, status: 200, headers: { get: () => null } };
    },
    async () => {
      const result = await requestPasswordResetLink("  Jenny@Example.COM ", "https://proset.ai");
      assert.deepEqual(result, { ok: true });
    },
  );

  assert.equal(seenUrl, "https://proset.ai/api/auth/forget-password");
  assert.equal(seenBody.email, "jenny@example.com");
});

test("requestPasswordResetLink maps the rate limit and failures to reasons the UI can translate", async () => {
  await withStubbedFetch(
    async () => ({ ok: false, status: 429, headers: { get: () => "42" } }),
    async () => {
      assert.deepEqual(await requestPasswordResetLink("a@b.com", "https://proset.ai"), {
        ok: false,
        reason: "rate_limited",
        retryAfterSeconds: 42,
      });
    },
  );

  await withStubbedFetch(
    async () => ({ ok: false, status: 500, headers: { get: () => null } }),
    async () => {
      assert.deepEqual(await requestPasswordResetLink("a@b.com", "https://proset.ai"), {
        ok: false,
        reason: "unavailable",
      });
    },
  );

  await withStubbedFetch(
    async () => {
      throw new Error("network down");
    },
    async () => {
      assert.deepEqual(await requestPasswordResetLink("a@b.com", "https://proset.ai"), {
        ok: false,
        reason: "unavailable",
      });
    },
  );

  let called = false;
  await withStubbedFetch(
    async () => {
      called = true;
      return { ok: true, status: 200, headers: { get: () => null } };
    },
    async () => {
      assert.deepEqual(await requestPasswordResetLink("   ", "https://proset.ai"), {
        ok: false,
        reason: "invalid_email",
      });
    },
  );
  assert.equal(called, false, "an empty address must not reach the server");
});
