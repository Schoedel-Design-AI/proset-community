import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer, request } from "node:http";

import {
  DEFAULT_TRANSCRIPTION_BURST_LIMIT,
  DEFAULT_TRANSCRIPTION_BURST_WINDOW_MS,
  createTranscriptionBurstLimiter,
  readTranscriptionBurstConfig,
  transcriptionBurstKey,
} from "../../server/rate-limits";

/**
 * The transcription burst limit has to bucket on the ACCOUNT, not on a socket.
 *
 * The app-level limiter this replaces ran before requireAuth, so its key collapsed
 * to the socket's peer address — behind Cloud Run that is the load balancer, which
 * means one shared bucket for every user of the product: a single abusive client
 * could throttle everyone, and unrelated users could throttle each other. These
 * tests pin the fixes, with real HTTP requests rather than a mocked middleware.
 */

const fakeRequest = (overrides: Record<string, unknown>) =>
  ({
    headers: {},
    socket: { remoteAddress: "10.0.0.1" },
    ...overrides,
  }) as any;

test("burst config: sane defaults, tunable by env, never disabled by a bad value", () => {
  const defaults = readTranscriptionBurstConfig({});
  assert.equal(defaults.limit, DEFAULT_TRANSCRIPTION_BURST_LIMIT);
  assert.equal(defaults.windowMs, DEFAULT_TRANSCRIPTION_BURST_WINDOW_MS);

  const tuned = readTranscriptionBurstConfig({
    PROSET_TRANSCRIPTION_BURST_LIMIT: "25",
    PROSET_TRANSCRIPTION_BURST_WINDOW_MS: "30000",
  });
  assert.equal(tuned.limit, 25);
  assert.equal(tuned.windowMs, 30000);

  for (const bad of ["0", "-3", "abc", "", "NaN"]) {
    const config = readTranscriptionBurstConfig({ PROSET_TRANSCRIPTION_BURST_LIMIT: bad });
    assert.equal(config.limit, DEFAULT_TRANSCRIPTION_BURST_LIMIT, `"${bad}" must not disable the limit`);
  }
});

test("burst key: per account when authenticated, per client address otherwise", () => {
  assert.equal(
    transcriptionBurstKey(fakeRequest({ userId: "user-123" })),
    "user:user-123",
    "an authenticated request must bucket by account",
  );

  // The bucket comes from req.ip — the address Express RESOLVED through the
  // trusted proxy chain — never from a caller-supplied x-forwarded-for prefix.
  // Reading the first entry minted a fresh bucket per forged header, which
  // defeated every limiter keyed on it (measured against production 2026-09-27).
  assert.equal(
    transcriptionBurstKey(fakeRequest({ headers: { "x-forwarded-for": "203.0.113.9, 70.41.3.18" }, ip: "70.41.3.18" })),
    "ip:70.41.3.18",
    "the resolved client address wins over the forwarded chain",
  );

  // Two requests differing ONLY in the forged prefix must share one bucket.
  // This is the regression: pre-fix these produced two buckets, so an attacker
  // escaped the limit by rotating the header.
  const forgedA = transcriptionBurstKey(fakeRequest({ headers: { "x-forwarded-for": "203.0.113.9" }, ip: "198.51.100.7" }));
  const forgedB = transcriptionBurstKey(fakeRequest({ headers: { "x-forwarded-for": "203.0.113.200" }, ip: "198.51.100.7" }));
  assert.equal(forgedA, forgedB, "a rotating x-forwarded-for must not mint a new bucket");
  assert.equal(forgedA, "ip:198.51.100.7");

  // IPv6: rotating inside your own /64 must not escape the bucket either.
  assert.equal(
    transcriptionBurstKey(fakeRequest({ ip: "2001:db8:1:2::1" })),
    transcriptionBurstKey(fakeRequest({ ip: "2001:db8:1:2::ffff" })),
    "addresses inside one IPv6 /64 share a bucket",
  );

  // No resolved address: fall back to the transport chain rather than collapsing
  // every caller into one bucket.
  assert.equal(transcriptionBurstKey(fakeRequest({ ip: "172.16.0.5" })), "ip:172.16.0.5");
  assert.equal(transcriptionBurstKey(fakeRequest({ ip: undefined })), "ip:10.0.0.1");
  assert.equal(transcriptionBurstKey(fakeRequest({ ip: undefined, socket: undefined })), "ip:unknown");
});

test("burst limiter: 429 after the burst, bucketed per account and per client, never globally", async (t) => {
  const env = { PROSET_TRANSCRIPTION_BURST_LIMIT: "3", PROSET_TRANSCRIPTION_BURST_WINDOW_MS: "60000" } as NodeJS.ProcessEnv;
  const limiter = createTranscriptionBurstLimiter(env);

  const app = express();
  // Mirrors the real mounting order: identity is established first, then the burst
  // limit is applied — which is what makes a per-account key possible at all.
  app.set("trust proxy", 1);
  app.post("/api/transcribe",
    (req, _res, next) => {
      const claimed = req.headers["x-test-user"] as string | undefined;
      if (claimed) req.userId = claimed;
      next();
    },
    limiter,
    (_req, res) => { res.json({ ok: true }); });

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const call = async (headers: Record<string, string>) => {
    // Raw http.request rather than fetch: fetch treats Host as a forbidden header
    // and strips it, which would send the request to the limiter as 127.0.0.1 and
    // (correctly) trip its localhost skip instead of exercising the limit.
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/api/transcribe",
          method: "POST",
          headers: {
            host: "proset.test",
            "content-type": "application/json",
            ...headers,
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (chunk) => { raw += chunk; });
          res.on("end", () => {
            let body: any = {};
            try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
            resolve({ status: res.statusCode ?? 0, body });
          });
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({}));
    });
  };

  // One account, three calls inside the window: allowed, then refused.
  const first = await call({ "x-test-user": "acct-a", "x-forwarded-for": "203.0.113.1" });
  const second = await call({ "x-test-user": "acct-a", "x-forwarded-for": "203.0.113.1" });
  const third = await call({ "x-test-user": "acct-a", "x-forwarded-for": "203.0.113.1" });
  const fourth = await call({ "x-test-user": "acct-a", "x-forwarded-for": "203.0.113.1" });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 200);
  assert.equal(fourth.status, 429, "the fourth call inside the window must be refused");
  assert.equal(fourth.body.code, "TRANSCRIPTION_BURST_LIMIT");
  assert.ok(fourth.body.error, "the refusal carries a user-facing message");

  // A different ACCOUNT from a different address is unaffected — the exact
  // regression where one shared bucket throttled everyone.
  const otherAccount = await call({ "x-test-user": "acct-b", "x-forwarded-for": "198.51.100.2" });
  assert.equal(otherAccount.status, 200, "one account's burst must not throttle another account");

  // A different ADDRESS on the same account shares the account's bucket: abuse is
  // tracked against the account, which rotating addresses cannot escape.
  const sameAccountNewAddress = await call({ "x-test-user": "acct-a", "x-forwarded-for": "198.51.100.99" });
  assert.equal(sameAccountNewAddress.status, 429, "an account keeps one bucket across addresses");

  // Unauthenticated bursts are bucketed by client address and do not consume an
  // account's budget.
  for (let i = 0; i < 3; i += 1) {
    const anonymous = await call({ "x-forwarded-for": "192.0.2.50" });
    assert.equal(anonymous.status, 200, `anonymous call ${i + 1} should be allowed`);
  }
  const anonymousBurst = await call({ "x-forwarded-for": "192.0.2.50" });
  assert.equal(anonymousBurst.status, 429, "an anonymous burst from one address is still capped");

  const stillFine = await call({ "x-test-user": "acct-c", "x-forwarded-for": "192.0.2.51" });
  assert.equal(stillFine.status, 200, "an anonymous burst must not throttle a signed-in account");

  // Cloud Run APPENDS the real client address, so the server sees
  // "<whatever the caller sent>, <real address>". With trust proxy=1 Express
  // resolves req.ip to that appended (rightmost) entry, so requests whose forged
  // prefixes differ but whose appended address is identical must share ONE bucket.
  // Pre-fix the FIRST entry was the key, so each forged prefix got its own bucket
  // and the limit was bypassed by simply rotating the header.
  for (let i = 0; i < 3; i += 1) {
    const allowed = await call({ "x-forwarded-for": `203.0.113.${100 + i}, 192.0.2.77` });
    assert.equal(allowed.status, 200, `call ${i + 1} from the appended address must be allowed`);
  }
  const forgedEscape = await call({ "x-forwarded-for": "198.51.100.250, 192.0.2.77" });
  assert.equal(forgedEscape.status, 429, "a rotating forged prefix must not mint a fresh bucket");
});

test("the development escape hatch cannot be reached in production", async (t) => {
  // req.hostname follows X-Forwarded-Host, so an ungated `localhost` check let any
  // caller switch a limiter off with a single header. The exemption is only safe
  // when it cannot fire in production — the shape server/auth.ts already used.
  const previousNodeEnv = process.env.NODE_ENV;
  const limiter = createTranscriptionBurstLimiter({
    PROSET_TRANSCRIPTION_BURST_LIMIT: "2",
    PROSET_TRANSCRIPTION_BURST_WINDOW_MS: "60000",
  } as NodeJS.ProcessEnv);

  const app = express();
  // Two hops, matching production: Cloudflare's append then Cloud Run's.
  app.set("trust proxy", 2);
  app.post("/api/transcribe", limiter, (_req, res) => { res.json({ ok: true }); });

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  t.after(() => {
    process.env.NODE_ENV = previousNodeEnv;
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const call = (headers: Record<string, string>) =>
    new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/api/transcribe",
          method: "POST",
          headers: { host: "proset.test", "content-type": "application/json", ...headers },
        },
        (res) => {
          res.on("data", () => {});
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({}));
    });

  process.env.NODE_ENV = "production";
  const forgedHost = {
    "x-forwarded-host": "localhost",
    "x-forwarded-for": "203.0.113.5, 198.51.100.66, 172.70.94.174",
  };
  assert.equal(await call(forgedHost), 200);
  assert.equal(await call(forgedHost), 200);
  assert.equal(
    await call(forgedHost),
    429,
    "X-Forwarded-Host: localhost must not switch the limit off in production",
  );
});
