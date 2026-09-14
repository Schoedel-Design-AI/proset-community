import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../app/recording/[id].tsx", import.meta.url),
  "utf8",
);

test("conversion results use the inset contact-form surface treatment", () => {
  assert.match(
    source,
    /conversionCard:\s*\{[\s\S]*?backgroundColor:\s*Colors\.surfaceLight[\s\S]*?borderRadius:\s*12[\s\S]*?borderWidth:\s*1[\s\S]*?borderColor:\s*Colors\.border/,
  );
});
