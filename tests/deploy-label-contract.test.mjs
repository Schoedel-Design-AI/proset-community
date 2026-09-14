import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deployScript = readFileSync(
  new URL("../scripts/deploy.sh", import.meta.url),
  "utf8",
);

test("both Cloud Run services receive the exact deployed commit label", () => {
  const labelAssignments = deployScript.match(
    /--update-labels "commit-sha=\$\{COMMIT_SHA\}"/g,
  );

  assert.equal(
    labelAssignments?.length,
    2,
    "the private worker and public service must both label each revision with COMMIT_SHA",
  );
});
