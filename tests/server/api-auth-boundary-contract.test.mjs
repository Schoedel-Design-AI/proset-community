import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = readFileSync("server/routes.ts", "utf8");

test("expensive document and calendar parsing endpoints require authentication", () => {
  assert.match(routes, /app\.post\("\/api\/generate-docx", requireAuth,/);
  assert.match(routes, /app\.post\("\/api\/generate-ics", requireAuth,/);
  assert.match(routes, /app\.post\("\/api\/calendar\/parse-events", requireAuth,/);
});

test("legacy audio files use an authenticated ownership-checked route", () => {
  assert.match(routes, /app\.get\("\/api\/audio-files\/\*key", requireAuth,/);
  assert.match(routes, /const ownsFile = recordings\.some\(/);
  assert.match(routes, /if \(!ownsFile\)/);
  assert.match(routes, /fs\.promises\.realpath\(audioUploadsDir\)/);
  assert.doesNotMatch(routes, /app\.use\("\/api\/audio-files",\s*express\.static\(/);
});
