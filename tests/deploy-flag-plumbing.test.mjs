import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * scripts/deploy.sh WRITES the purchase flags on every deploy, taking their
 * values from the environment and falling back to fail-safe defaults
 * (add-ons false, Music Pack false). The production workflow is the only thing
 * that supplies those values in CI, so if it stops exporting them, the next
 * scheduled deploy turns add-on sales off again - silently, because a paused
 * purchase returns 503 rather than breaking anything visible. These assertions
 * exist so that regression fails the suite instead of costing revenue.
 */

test("the production deploy exports the add-on purchase flag", async () => {
  const workflow = await readFile(".github/workflows/deploy-prod.yml", "utf8");
  assert.match(
    workflow,
    /PROSET_ADDON_PURCHASES_ENABLED:\s*\$\{\{\s*vars\.PROSET_ADDON_PURCHASES_ENABLED\s*\}\}/,
    "deploy-prod.yml must pass PROSET_ADDON_PURCHASES_ENABLED from a repository/environment variable",
  );
});

test("the production deploy exports the music pack flag", async () => {
  const workflow = await readFile(".github/workflows/deploy-prod.yml", "utf8");
  assert.match(
    workflow,
    /PROSET_MUSIC_PACK_ENABLED:\s*\$\{\{\s*vars\.PROSET_MUSIC_PACK_ENABLED\s*\}\}/,
    "deploy-prod.yml must pass PROSET_MUSIC_PACK_ENABLED so the parked product cannot be switched on by accident",
  );
});

test("the flags reach the deploy step, not just the file", async () => {
  const workflow = await readFile(".github/workflows/deploy-prod.yml", "utf8");
  const marker = "run: ./scripts/deploy.sh prod";
  const beforeDeploy = workflow.slice(0, workflow.indexOf(marker));
  // The env block for the deploy step is the LAST `env:` before the run line.
  const envBlock = beforeDeploy.slice(beforeDeploy.lastIndexOf("env:"));
  assert.match(envBlock, /PROSET_ADDON_PURCHASES_ENABLED/, "the flag must be in the deploy step's env block");
  assert.match(envBlock, /PROSET_MUSIC_PACK_ENABLED/, "the flag must be in the deploy step's env block");
});

/**
 * A purchase flag that defaults to off is a revenue stop waiting for one dropped
 * export: the deploy rewrites these values every run, and a paused purchase
 * answers 503 rather than raising anything an operator would notice. Only an
 * explicit `false` may pause sales, at every layer.
 */

test("deploy.sh defaults the add-on purchase flag to selling", async () => {
  const deploy = await readFile("scripts/deploy.sh", "utf8");
  assert.doesNotMatch(
    deploy,
    /PROSET_ADDON_PURCHASES_ENABLED:-false/,
    "scripts/deploy.sh must not fall back to false for the add-on flag",
  );
  assert.match(
    deploy,
    /--update-env-vars "PROSET_ADDON_PURCHASES_ENABLED=\$\{PROSET_ADDON_PURCHASES_ENABLED:-true\}"/,
    "scripts/deploy.sh must write the add-on flag, defaulting to true",
  );
});

test("the runtime policy defaults the add-on purchase flag to selling", async () => {
  const policy = await readFile("server/billing-policy.ts", "utf8");
  // Scope to the policy body: the type declaration above it also names the field.
  const body = policy.slice(policy.indexOf("export function getBillingPurchasePolicy"));
  const addonLine = body
    .split("\n")
    .find((line) => line.includes("addonPurchasesEnabled:"));
  assert.ok(addonLine, "billing-policy must define addonPurchasesEnabled");
  assert.match(
    addonLine,
    /enabledUnlessExplicitlyFalse\(process\.env\.PROSET_ADDON_PURCHASES_ENABLED\)/,
    "add-on purchases must default to enabled; the parked-product helper is not for plumbing flags",
  );
});

test("the documented environment default keeps add-ons on", async () => {
  const example = await readFile(".env.example", "utf8");
  assert.match(
    example,
    /^PROSET_ADDON_PURCHASES_ENABLED=true$/m,
    ".env.example must document add-on purchases as enabled by default",
  );
});

test("the deploy log prints the purchase flags it is about to write", async () => {
  const deploy = await readFile("scripts/deploy.sh", "utf8");
  assert.match(deploy, /Purchase flags written to this revision/, "a silent flag revert must be visible in the deploy log");
  assert.match(deploy, /add-ons\s+= \$\{PROSET_ADDON_PURCHASES_ENABLED:-true\}/);
});
