import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Wiring contract for the abuse gates.
 *
 * The unit tests prove the limiter and the ledger behave correctly in isolation.
 * These assertions pin the WIRING, which is what silently regresses: a limiter
 * that stops being applied, or is applied before authentication (where the account
 * is unknown and the bucket collapses to the load balancer's address), still
 * passes every unit test while protecting nobody.
 */

const ROUTER = "server/modules/recordings/router.ts";
const INDEX = "server/index.ts";
const USAGE_SERVICE = "server/usage-service.ts";
const RATE_LIMITS = "server/rate-limits.ts";

const read = (path) => readFile(path, "utf8");

test("transcription burst limit is applied to every in-app transcription route, after authentication", async () => {
  const router = await read(ROUTER);

  // Both charge paths: cloud transcription, and the on-device usage report.
  assert.match(
    router,
    /router\.post\(\s*"\/transcribe"\s*,\s*requireAuth\s*,\s*transcriptionBurstLimiter\s*,/,
    "POST /transcribe must carry the burst limiter",
  );
  assert.match(
    router,
    /router\.post\(\s*"\/recordings\/:id\/transcribe-local-usage"\s*,\s*requireAuth\s*,\s*transcriptionBurstLimiter\s*,/,
    "the on-device usage report must carry the burst limiter too",
  );

  // LIMITER AFTER AUTH: the key generator reads req.userId, which only exists once
  // requireAuth has run. Reversing this order would put every user in one bucket.
  const transcribeRoute = router.match(/router\.post\(\s*"\/transcribe"\s*,([^)]*)/);
  assert.ok(transcribeRoute, "the /transcribe route declaration must be findable");
  assert.ok(
    transcribeRoute[1].indexOf("requireAuth") < transcribeRoute[1].indexOf("transcriptionBurstLimiter"),
    "requireAuth must run before the limiter so the bucket can key on the account",
  );

  // One limiter instance per process, constructed from the shared module.
  assert.match(router, /const transcriptionBurstLimiter = createTranscriptionBurstLimiter\(\);/);
  assert.match(router, /import \{ createTranscriptionBurstLimiter \} from "\.\.\/\.\.\/rate-limits";/);
});

test("the app-level AI limiter no longer covers transcription, and never keys on the socket", async () => {
  const index = await read(INDEX);
  const rateLimits = await read(RATE_LIMITS);

  assert.doesNotMatch(
    index,
    /app\.use\(\s*"\/api\/transcribe"\s*,\s*aiLimiter\s*\)/,
    "transcription must not be double-limited at the app level (it would key on the socket)",
  );
  assert.match(index, /app\.use\(\s*"\/api\/convert"\s*,\s*aiLimiter\s*\)/, "/api/convert keeps its app-level limiter");

  // The remaining app-level AI limiter must key on the forwarded client address.
  const aiLimiterBlock = index.match(/const aiLimiter = rateLimit\(\{[\s\S]*?\n  \}\);/);
  assert.ok(aiLimiterBlock, "the aiLimiter block must be findable");
  assert.match(aiLimiterBlock[0], /keyGenerator:\s*getForwardedIp/, "the AI limiter must key on the client address");
  assert.doesNotMatch(
    aiLimiterBlock[0],
    /socket\.remoteAddress/,
    "keying on the socket collapses every user behind the proxy into one bucket",
  );

  // And the burst limiter must not key on the socket either.
  const keyBlock = rateLimits.match(/export function transcriptionBurstKey[\s\S]*?\n\}/);
  assert.ok(keyBlock, "transcriptionBurstKey must be findable");
  assert.doesNotMatch(keyBlock[0], /socket\.remoteAddress\s*\|\|/, "the burst key must not fall back to the socket first");
  assert.match(keyBlock[0], /req\.userId/, "the burst key must prefer the authenticated account");
});

test("the burst limit stays tunable and stays on by default", async () => {
  const rateLimits = await read(RATE_LIMITS);

  assert.match(rateLimits, /PROSET_TRANSCRIPTION_BURST_LIMIT/);
  assert.match(rateLimits, /PROSET_TRANSCRIPTION_BURST_WINDOW_MS/);
  assert.match(rateLimits, /DEFAULT_TRANSCRIPTION_BURST_LIMIT = 10/);
  assert.match(rateLimits, /DEFAULT_TRANSCRIPTION_BURST_WINDOW_MS = 60_000/);
  // An invalid value must fall back to the default rather than disable the gate.
  assert.match(rateLimits, /if \(!Number\.isFinite\(value\) \|\| value <= 0\) return fallback;/);
});

test("unmetered usage is recorded on every skipped charge, and can never block one", async () => {
  const usageService = await read(USAGE_SERVICE);

  // Both skip sites write to the ledger.
  const transcriptionCharge = usageService.match(/export async function deductTranscriptionTokens[\s\S]*?\n\}/);
  assert.ok(transcriptionCharge, "deductTranscriptionTokens must be findable");
  assert.match(transcriptionCharge[0], /isSuperAdmin\(userId\)/);
  assert.match(transcriptionCharge[0], /recordUnmeteredUsage\(\{ userId, kind: "transcription"/);
  assert.match(transcriptionCharge[0], /Number\.MAX_SAFE_INTEGER/, "the unmetered account must still not be refused");

  const conversionCharge = usageService.match(/export async function deductConversionTokens[\s\S]*?\n\}/);
  assert.ok(conversionCharge, "deductConversionTokens must be findable");
  assert.match(conversionCharge[0], /recordUnmeteredUsage\(\{ userId, kind: "conversion"/);

  // The ledger write is best-effort: it swallows its own failure so visibility can
  // never break the work it observes. Sliced between declarations because the
  // function's own parameter type block also ends in a brace.
  const ledgerStart = usageService.indexOf("async function recordUnmeteredUsage");
  const ledgerEnd = usageService.indexOf("async function getFriendsOfBarryTermSummary");
  assert.ok(ledgerStart > -1 && ledgerEnd > ledgerStart, "recordUnmeteredUsage must be findable");
  const ledger = usageService.slice(ledgerStart, ledgerEnd);
  assert.match(ledger, /try \{/, "the ledger write must be guarded");
  assert.match(ledger, /catch \(error\)/, "a ledger failure must be caught");
  assert.match(ledger, /console\.warn\(/, "a swallowed failure must still be logged");
  assert.doesNotMatch(ledger, /throw/, "a ledger failure must never propagate");

  // The alert is visibility only: nothing in the ledger or the alert threshold path
  // may return a blocking decision.
  assert.match(usageService, /\[usage-alert\]/);
  assert.match(usageService, /PROSET_UNMETERED_USAGE_ALERT_TOKENS/);
  assert.match(usageService, /DEFAULT_UNMETERED_USAGE_ALERT_TOKENS = 250_000/);
});
