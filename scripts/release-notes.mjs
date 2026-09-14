#!/usr/bin/env node
/**
 * Release notes & changelog automation (issue #218).
 *
 * Proset publishes daily (cron deploys), so a human-curated changelog does not
 * scale. This script derives each release's notes deterministically from the
 * merged pull requests since the last release, groups them into Keep-a-Changelog
 * sections by conventional-commit prefix, and cuts a new `## [X.Y.Z] - DATE`
 * section at the top of CHANGELOG.md.
 *
 * It also prints a docs-review checklist: any merged PR that touched a subsystem
 * with matching documentation under `docs-site/` is flagged so the docs are
 * reviewed against the change before the release ships.
 *
 * Usage:
 *   node scripts/release-notes.mjs --dry-run     # print the section, don't write
 *   node scripts/release-notes.mjs               # write CHANGELOG.md + docs checklist
 *   node scripts/release-notes.mjs --version 1.0.10   # explicit version
 *
 * Requires `gh` (authenticated) to enumerate merged PRs.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHANGELOG_PATH = path.join(ROOT, "CHANGELOG.md");

/** Map a conventional-commit title to a Keep-a-Changelog section. */
export function classifyPr(title = "") {
  const t = typeof title === "string" ? title.trim() : "";
  const conventionalType = /^(?<type>[a-z]+)(?:\([^)]*\))?!?:/.exec(t)?.groups?.type.toLowerCase();
  const type = conventionalType || t.split(/[\s:]/, 1)[0].toLowerCase();
  if (["revert", "remove", "drop"].includes(type)) return "Removed";
  if (type === "security" || /\bsecurity\b/i.test(t)) return "Security";
  if (["feat", "add", "new"].includes(type)) return "Added";
  if (["fix", "bug", "hotfix", "patch"].includes(type)) return "Fixed";
  // ops, chore, docs, build, ci, perf, refactor -> "Changed" by default
  return "Changed";
}

/**
 * Build a Keep-a-Changelog section for one release. Pure + unit-tested.
 * `prs` is an array of `{ number, title }`.
 */
export function buildChangelogSection(prs, version, date) {
  const groups = { Added: [], Fixed: [], Changed: [], Removed: [], Security: [] };
  for (const pr of prs) {
    const group = classifyPr(pr.title);
    // Strip the conventional prefix from the bullet text for readability.
    const title = typeof pr.title === "string" ? pr.title : "";
    const clean = title.replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, "").trim() || "(untitled change)";
    groups[group].push(`- ${clean} ([#${pr.number}](https://github.com/schoedel-learn/barry-ai/pull/${pr.number}))`);
  }

  const order = ["Added", "Fixed", "Changed", "Removed", "Security"];
  const lines = [`## [${version}] - ${date}`];
  for (const key of order) {
    if (groups[key].length === 0) continue;
    lines.push("", `### ${key}`);
    for (const item of groups[key]) lines.push(item);
  }
  return lines.join("\n") + "\n";
}

/** Bump the patch version of a semver string. */
export function bumpPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) return version;
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** Latest released version + its date, from the top `## [X.Y.Z] - DATE` heading. */
export function parseLatestRelease(changelog) {
  const m = changelog.match(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/m);
  if (!m) return null;
  return { version: m[1], date: m[2] };
}

/** Enumerate merged PRs since `sinceDate` (ISO yyyy-mm-dd) via `gh`. */
function collectMergedPrs(sinceDate) {
  try {
    const out = execFileSync(
      "gh",
      [
        "pr", "list", "-R", "schoedel-learn/barry-ai", "--state", "merged",
        "--search", `merged:>${sinceDate}`,
        "--limit", "200", "--json", "number,title",
      ],
      { encoding: "utf8" },
    );
    return JSON.parse(out);
  } catch (err) {
    console.warn(`[release-notes] gh pr list failed (${err.message}); falling back to empty.`);
    return [];
  }
}

/** Files changed between two git refs, for the docs-review sweep. */
function changedFiles(sinceDate) {
  try {
    const out = execFileSync("git", ["log", "--since", sinceDate, "--name-only", "--pretty=format:"], {
      cwd: ROOT, encoding: "utf8",
    });
    return [...new Set(out.split("\n").map((l) => l.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

/** Find docs-site pages that mention a changed source subsystem. */
function docsReviewChecklist(files) {
  const docsDir = path.join(ROOT, "docs-site", "docs");
  const checklist = [];
  // Map a changed source path to candidate search terms.
  const terms = new Set();
  for (const f of files) {
    const base = path.basename(f).replace(/\.(ts|tsx|js|mjs)$/i, "");
    if (base) terms.add(base);
  }
  for (const term of terms) {
    try {
      const hits = execFileSync("grep", ["-ril", term, docsDir], { encoding: "utf8" })
        .split("\n").map((l) => l.trim()).filter(Boolean);
      for (const h of hits) checklist.push({ term, doc: path.relative(ROOT, h) });
    } catch {
      // no matches — fine
    }
  }
  return checklist;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const versionIdx = args.indexOf("--version");
  const explicitVersion = versionIdx >= 0 ? args[versionIdx + 1] : undefined;

  const changelog = readFileSync(CHANGELOG_PATH, "utf8");
  const latest = parseLatestRelease(changelog);
  const sinceDate = latest ? latest.date : "2000-01-01";
  const version = explicitVersion || currentProductVersion() || (latest ? bumpPatch(latest.version) : "1.0.0");
  const date = new Date().toISOString().slice(0, 10);

  const prs = collectMergedPrs(sinceDate);
  // Keep the docs-review sweep useful even when there is no release section to
  // generate; the workflow runs on every publish, not only PR merges.
  const files = changedFiles(sinceDate);
  const checklist = docsReviewChecklist(files);
  if (prs.length === 0) {
    console.log("[release-notes] No merged PRs since " + sinceDate + " — nothing to release.");
    printDocsReviewChecklist(checklist);
    return;
  }

  const section = buildChangelogSection(prs, version, date);

  // Docs-review sweep runs in BOTH modes — the workflow always runs --dry-run,
  // so the docs check must not be gated behind the write path.
  if (dryRun) {
    console.log(section);
    console.log(`\n(${prs.length} PRs; would prepend as ${version} on ${date})`);
  } else {
    // Insert the new section after the header block, before "## [Unreleased]".
    const headerEnd = changelog.indexOf("## [Unreleased]");
    if (headerEnd < 0) {
      console.error("[release-notes] Could not find '## [Unreleased]' in CHANGELOG.md — aborting.");
      process.exit(1);
    }
    const updated = changelog.slice(0, headerEnd) + section + "\n" + changelog.slice(headerEnd);
    writeFileSync(CHANGELOG_PATH, updated);
    console.log(`[release-notes] Wrote ${version} (${date}) to CHANGELOG.md with ${prs.length} PRs.`);
  }

  printDocsReviewChecklist(checklist);
}

function printDocsReviewChecklist(checklist) {
  if (checklist.length > 0) {
    console.log("\n[release-notes] Docs-review sweep — review these docs against the change:");
    for (const item of checklist) console.log(`  - ${item.doc} (mentions "${item.term}")`);
  } else {
    console.log("\n[release-notes] Docs-review sweep: no docs-site pages match the changed files.");
  }
}

/** Current shipped version from package.json (source of truth). */
function currentProductVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
