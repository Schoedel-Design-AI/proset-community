/**
 * Contract: every call the integrations screen makes to a route that requires a
 * session must send the bearer header.
 *
 * Why this guard is derived from the server's route table instead of a
 * hand-written list: the connection-test buttons already failed this way once
 * (`credentials: "include"` with no Authorization header -> requireAuth returns
 * 401 -> the UI says "connection failed" while the provider list, which DOES
 * send the header, shows the account as connected). The same defect survived in
 * six more calls in the same file, so a two-entry list cannot hold the
 * invariant.
 *
 * Coverage note: calls whose URL is not a string literal (for example
 * `expoFetch(url.toString(), ...)`) cannot be matched here and are not checked.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync("server/routes.ts", "utf8");
const screen = readFileSync("app/settings/integrations.tsx", "utf8");

/** /api/... paths guarded by requireAuth, e.g. /api/backup/providers/:id/test */
function authRequiredPaths(): string[] {
  const paths: string[] = [];
  const routePattern = /app\.(?:get|post|put|delete)\(\s*"(?<path>\/api\/[^"]+)"\s*,\s*requireAuth/g;
  for (const match of routes.matchAll(routePattern)) {
    const path = match.groups?.path;
    if (path) paths.push(path);
  }
  return paths;
}

/**
 * Segment signature, so "/api/backup/providers/:id/test" matches the client's
 * "/api/backup/providers/${providerId}/test".
 */
function signature(path: string): string {
  return path
    .split("/")
    .map((segment) => (segment.startsWith(":") || segment.includes("${") ? ":" : segment))
    .join("/");
}

const callPattern = /(?:expoFetch|globalThis\.fetch|fetch)\(\s*(?:new URL\()?\s*(`[^`]*`|"[^"]*")/g;
const singleCallPattern = /(?:expoFetch|globalThis\.fetch|fetch)\(\s*(?:new URL\()?\s*(`[^`]*`|"[^"]*")/;

test("every integrations call to an auth-required route sends the bearer header", () => {
  const guarded = new Set(authRequiredPaths().map(signature));
  assert.ok(guarded.size > 0, "expected the server route table to expose auth-required /api paths");

  const starts = [...screen.matchAll(callPattern)].map((match) => match.index as number);
  const violations: string[] = [];
  let checked = 0;

  starts.forEach((start, index) => {
    // Stop at the next call so a neighbouring call's headers can never satisfy
    // this one -- an unbounded match is how a guard goes vacuous.
    const end = Math.min(starts[index + 1] ?? screen.length, start + 800);
    const block = screen.slice(start, end);
    const literal = block.match(singleCallPattern)?.[1]?.slice(1, -1) ?? "";
    if (!guarded.has(signature(literal))) return;

    checked += 1;
    if (!block.includes("getAuthHeaders()")) {
      const line = screen.slice(0, start).split("\n").length;
      violations.push(`app/settings/integrations.tsx:${line} calls ${literal} without getAuthHeaders()`);
    }
  });

  assert.ok(checked > 0, "expected the screen to call at least one auth-required route");
  assert.deepEqual(
    violations,
    [],
    `auth-required calls are missing the bearer header:\n${violations.join("\n")}`,
  );
});

test("the connection-test calls send the bearer header", () => {
  // The specific regression behind the report: the test buttons 401'd while the
  // provider list rendered as connected.
  assert.match(
    screen,
    /const handleTestProvider = async \(providerId: string\) => \{[\s\S]*?expoFetch\(new URL\(`\/api\/backup\/providers\/\$\{providerId\}\/test`, baseUrl\)\.toString\(\), \{[\s\S]*?headers: getAuthHeaders\(\),/,
  );
  assert.match(
    screen,
    /const handleTestTask = async \(providerId: string\) => \{[\s\S]*?expoFetch\(new URL\(`\/api\/tasks\/providers\/\$\{providerId\}\/test`, baseUrl\)\.toString\(\), \{[\s\S]*?headers: getAuthHeaders\(\),/,
  );
});

test("both provider deletes reject on a non-2xx instead of reporting success", () => {
  // `fetch` resolves on HTTP errors, so a delete that never checks `res.ok`
  // reloads the list and fires success haptics after a 401/500: the row stays
  // put and the user is told nothing. Both provider deletes must throw on a
  // non-2xx so the surrounding catch reports the failure.
  assert.match(
    screen,
    /await expoFetch\(new URL\(`\/api\/backup\/providers\/\$\{provider\.id\}`, baseUrl\)\.toString\(\), \{\s*method: "DELETE",[\s\S]{0,400}?if \(!res\.ok\) throw new Error\(`delete provider failed: \$\{res\.status\}`\);/,
    "the backup provider delete must check res.ok",
  );
  assert.match(
    screen,
    /await expoFetch\(new URL\(`\/api\/tasks\/providers\/\$\{providerId\}`, baseUrl\)\.toString\(\), \{\s*method: "DELETE",[\s\S]{0,400}?if \(!res\.ok\) throw new Error\(`delete task provider failed: \$\{res\.status\}`\);/,
    "the task provider delete must check res.ok",
  );
});
