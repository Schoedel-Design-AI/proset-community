import assert from "node:assert/strict";
import test from "node:test";

import { buildReturnTo, buildReturnToFromSearch, resolvePostLoginRoute } from "../../lib/auth-redirect";

test("buildReturnTo preserves pathname and query params", () => {
  assert.equal(
    buildReturnTo("/settings/account", { tab: "subscription", subscription: "success" }),
    "/settings/account?tab=subscription&subscription=success",
  );
});

test("resolvePostLoginRoute keeps safe in-app destinations", () => {
  assert.equal(resolvePostLoginRoute("/settings/account?tab=subscription"), "/settings/account?tab=subscription");
});

test("buildReturnToFromSearch normalizes a raw query string", () => {
  assert.equal(
    buildReturnToFromSearch("/choose-plan", "?subscription=success"),
    "/choose-plan?subscription=success",
  );
});

test("resolvePostLoginRoute rejects unsafe or login-loop destinations", () => {
  assert.equal(resolvePostLoginRoute("https://example.com"), "/");
  assert.equal(resolvePostLoginRoute("//example.com"), "/");
  assert.equal(resolvePostLoginRoute("/login?returnTo=%2Fsettings"), "/");
  assert.equal(resolvePostLoginRoute(undefined), "/");
});
