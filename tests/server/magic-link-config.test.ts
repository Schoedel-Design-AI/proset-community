import test from "node:test";
import assert from "node:assert/strict";
import { buildMagicLinkLoginUrl, normalizeOrigin, parseBooleanEnv } from "../../server/magic-link-config";

test("parseBooleanEnv accepts common truthy variants", () => {
  assert.equal(parseBooleanEnv("true"), true);
  assert.equal(parseBooleanEnv("1"), true);
  assert.equal(parseBooleanEnv("yes"), true);
  assert.equal(parseBooleanEnv("on"), true);
});

test("parseBooleanEnv defaults to false for unknown values", () => {
  assert.equal(parseBooleanEnv(undefined), false);
  assert.equal(parseBooleanEnv(""), false);
  assert.equal(parseBooleanEnv("false"), false);
  assert.equal(parseBooleanEnv("0"), false);
});

test("normalizeOrigin preserves explicit protocol and normalizes local hosts", () => {
  assert.equal(normalizeOrigin("https://proset.ai/"), "https://proset.ai");
  assert.equal(normalizeOrigin("localhost:5000"), "http://localhost:5000");
});

test("buildMagicLinkLoginUrl encodes token on login route", () => {
  const url = buildMagicLinkLoginUrl("abc 123", "https://proset.ai");
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://proset.ai");
  assert.equal(parsed.pathname, "/login");
  assert.equal(parsed.searchParams.get("magic_token"), "abc 123");
});
