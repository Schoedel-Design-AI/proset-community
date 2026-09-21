import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { generatePassword, generatePasswordForRole, getPasswordLengthForRole } from "../../lib/password-generator";
import { USER_PASSWORD_MIN_LENGTH } from "../../shared/password-validation";

/**
 * The "Generate password" controls were dead on Android: Hermes has no
 * `crypto.getRandomValues`, and lib/password-generator.ts refuses to fall back
 * to Math.random() for passwords, so it threw on every tap. These tests pin both
 * halves — a real RNG source at boot, and a generator that never degrades to a
 * predictable one.
 *
 * CE OVERRIDE of the main-side test: the CE password generator (and the CE
 * tree as a whole) has no internal admin role, so the role sweep covers only
 * `user` and `admin`. Keep the rest of this file in step with main.
 */

test("the native entry installs a crypto RNG before anything can use it", () => {
  const entry = readFileSync("index.js", "utf8");

  assert.match(entry, /^import "react-native-get-random-values";/m);

  // Order matters: it must be the FIRST import, so no module reads crypto while
  // loading before the polyfill is installed.
  const firstImport = entry.match(/^import .*$/m)?.[0] ?? "";
  assert.equal(
    firstImport,
    'import "react-native-get-random-values";',
    "the crypto polyfill must be the first import in index.js",
  );

  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(
    pkg.dependencies["react-native-get-random-values"],
    "react-native-get-random-values must stay a runtime dependency",
  );
});

test("the password generator never falls back to a predictable RNG", () => {
  const source = readFileSync("lib/password-generator.ts", "utf8");
  assert.doesNotMatch(source, /Math\.random/, "password generation must not use Math.random");
  assert.match(source, /No cryptographically secure RNG available/);
});

test("generated passwords satisfy the server's minimum length for every role", () => {
  for (const role of ["user", "admin"] as const) {
    for (let i = 0; i < 25; i += 1) {
      const pw = generatePasswordForRole(role);
      assert.ok(
        pw.length >= USER_PASSWORD_MIN_LENGTH,
        `${role} password ${pw.length} chars is below the ${USER_PASSWORD_MIN_LENGTH} minimum`,
      );
      assert.equal(pw.length, getPasswordLengthForRole(role));
    }
  }
});

test("generated passwords vary between draws and mix character classes", () => {
  const draws = new Set<string>();
  let mixedClasses = 0;
  for (let i = 0; i < 100; i += 1) {
    const pw = generatePassword(32);
    draws.add(pw);
    const classes = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
    if (classes >= 3) mixedClasses += 1;
  }
  assert.equal(draws.size, 100, "100 draws must produce 100 distinct passwords");
  assert.equal(mixedClasses, 100, "every 32-char draw should mix at least 3 character classes");
});
