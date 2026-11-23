import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readTranscriptCard(relativePath: string): string {
  const source = readFileSync(join(root, relativePath), "utf8");
  const match = source.match(/transcriptCard:\s*\{([\s\S]*?)\n\s*\},/);
  assert.ok(match, `${relativePath} should define transcriptCard styles`);
  return match[1];
}

test("recording transcript cards have an inner border on app surfaces", () => {
  for (const relativePath of [
    "app/recording/[id].tsx",
    "scripts/ce-export/overrides/app/recording/[id].tsx",
  ]) {
    const styles = readTranscriptCard(relativePath);
    assert.match(styles, /borderWidth:\s*1,/);
    assert.match(styles, /borderColor:\s*Colors\.border,/);
  }
});
