import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Contract for the forgot-password flow, which used to end every one of its
 * states at a single "Back to Sign In" button:
 *
 *   - after requesting a link      -> the user's next task is reading mail, so
 *                                     the primary action is their mailbox, the
 *                                     second is a resend (with a cooldown, so the
 *                                     server's rate limit is never the thing that
 *                                     tells them to wait), and signing in stays a
 *                                     quiet escape hatch
 *   - after a successful reset     -> they are signed in with the password they
 *                                     just chose; no retyping
 *   - after an expired/used link   -> "send me a new link" on the spot, instead
 *                                     of a dead end back at the sign-in form
 *
 * These assertions read the source on purpose: the behaviours that make the flow
 * work are the affordances present (and absent) in these files.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(repoRoot, relative), "utf8");

const NEW_KEYS = [
  "login.resetLinkSentTo",
  "login.openEmailApp",
  "login.openWebmail",
  "login.resendLink",
  "login.resendLinkIn",
  "login.changeEmail",
  "login.sendNewResetLink",
  "login.signingIn",
  "login.resetRequestRateLimited",
  "login.resetRequestUnavailable",
];

test("the login sheet's sent state hands over the mailbox instead of sending the user back to sign in", async () => {
  const login = await read("app/login.tsx");
  const sentStart = login.indexOf('resetMode === "sent"');
  assert.ok(sentStart > -1, "the reset sheet must keep an explicit sent state");
  const sentBlock = login.slice(sentStart, login.indexOf("</Pressable>", sentStart));

  assert.match(sentBlock, /<ResetLinkSent/, "the sent state is the shared confirmation component");
  assert.doesNotMatch(
    sentBlock,
    /styles\.submitButtonText\}>\{t\("login\.backToSignIn"\)/,
    "signing in must not be the primary (filled) action after a request",
  );
});

test("the confirmation offers the mailbox, a cooldown resend, and a quiet sign-in link", async () => {
  const component = await read("components/ResetLinkSent.tsx");

  // testIDs are interpolated from the component's `testID` prop, so the suffix is
  // what to look for in the source.
  for (const suffix of ["open-mail", "resend", "change-email", "back-to-signin"]) {
    assert.ok(
      component.includes("${testID}-" + suffix + "`"),
      `expected the ${suffix} affordance to exist in the confirmation`,
    );
  }

  assert.match(component, /resendCooldownRemaining/, "the resend must respect the cooldown");
  assert.match(component, /login\.resendLinkIn/, "the cooldown must be visible as text, not a refusal");
  assert.doesNotMatch(
    component,
    /primaryButtonText\}>\{t\("login\.backToSignIn"\)/,
    "the filled button must not be the sign-in escape hatch",
  );
  assert.match(component, /styles\.link\}/, "sign-in lives as a text link");
});

test("the mailbox hand-off opens the inbox on Android, not a blank composer", async () => {
  // `mailto:` resolves to Gmail's ComposeActivityGmailExternal on Android — the
  // wrong destination. ACTION_MAIN + CATEGORY_APP_EMAIL resolves to the mailbox.
  const kotlin = await read(
    "android/app/src/main/java/ms/aifor/app/mailbox/MailboxModule.kt",
  );
  assert.match(kotlin, /Intent\.CATEGORY_APP_EMAIL/);
  assert.match(kotlin, /Intent\.ACTION_MAIN/);

  const js = await read("lib/mailbox.ts");
  assert.match(js, /NativeModules[\s\S]{0,120}Mailbox/, "the native module is the first attempt");
  assert.match(js, /mailto:/, "mailto: stays as the fallback when nothing handles the category");
  assert.match(js, /message:\/\//, "iOS uses the Mail inbox scheme");
});

test("a completed reset signs the person in and an expired link can request a new one", async () => {
  const screen = await read("app/reset-password.tsx");

  assert.match(
    screen,
    /signInWithNewPassword\(actionEmail, newPassword\)/,
    "after confirmPasswordReset the app signs in with the password just chosen",
  );
  assert.match(screen, /login\.sendNewResetLink/, "the expired state offers a new link");
  assert.match(screen, /submitRecoveryRequest/, "the expired state can request a link itself");
  assert.match(screen, /requestPasswordResetLink\(cleanEmail, getApiUrl\(\)\)/);

  const login = await read("app/login.tsx");
  assert.match(
    login,
    /params\.email \?\? ""/,
    "the sign-in screen prefills the address handed to it by the reset screen",
  );
});

test("every new string exists in both languages", async () => {
  const i18n = await read("lib/i18n.tsx");
  const splitAt = i18n.indexOf("  es: {");
  assert.ok(splitAt > 0, "lib/i18n.tsx must keep an `es` block");
  const en = i18n.slice(0, splitAt);
  const es = i18n.slice(splitAt);

  for (const key of NEW_KEYS) {
    assert.ok(en.includes(`"${key}"`), `${key} is missing from the English strings`);
    assert.ok(es.includes(`"${key}"`), `${key} is missing from the Spanish strings`);
  }
});
