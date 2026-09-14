/**
 * Contract coverage for issue #227: saved .txt content must not regress to the
 * small metadata-size typography used elsewhere on the Files screen.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filesScreen = readFileSync(path.join(repoRoot, "app/files.tsx"), "utf8");
const contentStyleStart = filesScreen.indexOf("fileContentText: {");
const contentStyle = filesScreen.slice(contentStyleStart, contentStyleStart + 400);

test("text-file content uses reading-size typography", () => {
  assert.ok(contentStyleStart >= 0, "file content style should exist");
  assert.match(contentStyle, /fontSize:\s*sf\(18,\s*ts\)/);
  assert.match(contentStyle, /lineHeight:\s*sf\(28,\s*ts\)/);
});
