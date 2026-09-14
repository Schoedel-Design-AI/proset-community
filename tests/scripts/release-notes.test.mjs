import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChangelogSection,
  bumpPatch,
  classifyPr,
  parseLatestRelease,
} from "../../scripts/release-notes.mjs";

test("classifyPr groups conventional-commit titles into Keep-a-Changelog sections", () => {
  assert.equal(classifyPr("feat(analytics): track landing interactions"), "Added");
  assert.equal(classifyPr("add: cycling waiting-state verbs"), "Added");
  assert.equal(classifyPr("fix(android): Play-aware version bump"), "Fixed");
  assert.equal(classifyPr("bug: crash on startup"), "Fixed");
  assert.equal(classifyPr("ops: comped Pro provisioning"), "Changed");
  assert.equal(classifyPr("docs: refresh README"), "Changed");
  assert.equal(classifyPr("remove: legacy send-to-AI"), "Removed");
  assert.equal(classifyPr("security: harden API boundary"), "Security");
  assert.equal(classifyPr("feature: avoid matching a longer prefix"), "Changed");
  assert.equal(classifyPr("feat!: make the capture flow safer"), "Added");
  assert.equal(classifyPr(null), "Changed");
});

test("buildChangelogSection emits a Keep-a-Changelog block with PR links", () => {
  const prs = [
    { number: 209, title: "feat(analytics): track every landing interaction" },
    { number: 206, title: "fix(android): Play-aware version bump" },
    { number: 208, title: "ops: comped Pro provisioning" },
  ];
  const section = buildChangelogSection(prs, "1.0.10", "2026-09-04");

  assert.match(section, /^## \[1\.0\.10\] - 2026-09-04/m);
  assert.match(section, /### Added/);
  assert.match(section, /track every landing interaction \(\[#209\]/);
  assert.match(section, /### Fixed/);
  assert.match(section, /Play-aware version bump \(\[#206\]/);
  assert.match(section, /### Changed/);
  assert.match(section, /comped Pro provisioning \(\[#208\]/);
  // Conventional prefix is stripped from the bullet text.
  assert.doesNotMatch(section, /^-\s+feat\(/m);
});

test("buildChangelogSection strips all conventional prefixes", () => {
  const section = buildChangelogSection([
    { number: 210, title: "remove(scope)!: legacy behavior" },
    { number: 211, title: "security: harden boundary" },
  ], "1.0.10", "2026-09-04");

  assert.match(section, /- legacy behavior/);
  assert.match(section, /- harden boundary/);
  assert.doesNotMatch(section, /- remove\(scope\)!:/);
  assert.doesNotMatch(section, /- security:/);
});

test("bumpPatch increments the patch component", () => {
  assert.equal(bumpPatch("1.0.9"), "1.0.10");
  assert.equal(bumpPatch("2.3.4"), "2.3.5");
  assert.equal(bumpPatch("not-semver"), "not-semver");
});

test("parseLatestRelease reads the top version heading", () => {
  const changelog = `# Changelog\n\n## [Unreleased]\n\n### Added\n- x\n\n## [1.0.9] - 2026-08-28\n`;
  assert.deepEqual(parseLatestRelease(changelog), { version: "1.0.9", date: "2026-08-28" });
  assert.equal(parseLatestRelease("# Changelog\n\n## [Unreleased] - soon\n"), null);
});
