import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DYNAMIC_NATIVE_ROUTES,
  NATIVE_ROUTE_NAMES,
  NOT_FOUND_ROUTE,
  dynamicRouteParams,
  resolveNativeRoute,
} from "../../lib/native-routes";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const nativeAdapter = readFileSync(path.join(repoRoot, "lib/navigation.tsx"), "utf8");

function registeredNativeScreens(): string[] {
  return [...nativeAdapter.matchAll(/<StackNav\.Screen\s+name="([^"]+)"/g)].map((match) => match[1]);
}

test("thought thread detail resolves to its registered screen with the id param", () => {
  // Regression guard for #193 / #199: both the cloud icon on the recording
  // screen and the "+" on the Thought Threads screen push this path, and an
  // unregistered screen name is a silent no-op in a release build.
  const target = resolveNativeRoute("/thought-thread/tt_abc123");
  assert.equal(target.screen, "thought-thread/[id]");
  assert.equal(target.params.id, "tt_abc123");
});

test("recording detail keeps resolving with query params merged", () => {
  const target = resolveNativeRoute("/recording/rec_9?tab=recording");
  assert.equal(target.screen, "recording/[id]");
  assert.deepEqual(target.params, { tab: "recording", id: "rec_9" });
});

test("dynamic segments are percent-decoded", () => {
  const target = resolveNativeRoute("/thought-thread/tt%20one");
  assert.equal(target.screen, "thought-thread/[id]");
  assert.equal(target.params.id, "tt one");
});

test("static and nested static routes resolve unchanged", () => {
  assert.equal(resolveNativeRoute("/").screen, "index");
  assert.equal(resolveNativeRoute("/thought-threads").screen, "thought-threads");
  assert.equal(resolveNativeRoute("/music").screen, "music");
  const settings = resolveNativeRoute("/settings/account?tab=subscription");
  assert.equal(settings.screen, "settings/account");
  assert.equal(settings.params.tab, "subscription");
});

test("unregistered paths fall back to the not-found screen instead of failing silently", () => {
  assert.equal(resolveNativeRoute("/does-not-exist").screen, NOT_FOUND_ROUTE);
  assert.equal(resolveNativeRoute("/settings/nope").screen, NOT_FOUND_ROUTE);
});

test("dynamicRouteParams exposes the path param for every dynamic route", () => {
  assert.deepEqual(dynamicRouteParams("/thought-thread/tt_1"), { id: "tt_1" });
  assert.deepEqual(dynamicRouteParams("/recording/rec_1"), { id: "rec_1" });
  assert.deepEqual(dynamicRouteParams("/recordings"), {});
  assert.deepEqual(dynamicRouteParams("/thought-thread"), {});
});

test("route table matches the screens registered on the native stack", () => {
  const registered = registeredNativeScreens();
  assert.ok(registered.length > 20, `expected the native stack to register screens, saw ${registered.length}`);
  assert.deepEqual(
    [...NATIVE_ROUTE_NAMES].sort(),
    [...registered].sort(),
    "lib/native-routes.ts NATIVE_ROUTE_NAMES must list exactly the screens registered in lib/navigation.tsx",
  );
});

test("every dynamic route points at a registered screen", () => {
  for (const route of DYNAMIC_NATIVE_ROUTES) {
    assert.ok(
      NATIVE_ROUTE_NAMES.includes(route.screen),
      `${route.screen} is not registered on the native stack`,
    );
    assert.ok(
      route.screen.includes(`[${route.param}]`),
      `${route.screen} does not carry a [${route.param}] segment`,
    );
  }
});

test("every dynamic screen file under app/ has a route table entry", () => {
  const dynamicScreens = [...nativeAdapter.matchAll(/from "\.\.\/app\/([^"]*\[[^"]+\])"/g)]
    .map((match) => match[1].replace(/\.tsx?$/, ""));
  assert.ok(dynamicScreens.length >= 2, `expected dynamic screen imports, saw ${dynamicScreens.length}`);
  for (const screen of dynamicScreens) {
    assert.ok(
      DYNAMIC_NATIVE_ROUTES.some((route) => route.screen === screen),
      `${screen} has no DYNAMIC_NATIVE_ROUTES entry, so router.push() would silently do nothing`,
    );
  }
});
