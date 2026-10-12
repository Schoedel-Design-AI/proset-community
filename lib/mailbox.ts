import { Linking, NativeModules, Platform } from "react-native";

import { webmailFor } from "@/lib/password-reset";

/**
 * "Go read your email" hand-off.
 *
 * `mailto:` is the standard interop URL, but it is the wrong destination for
 * this job on every surface that matters:
 *
 * - Android: `mailto:` resolves to a COMPOSE activity. Verified on device:
 *   `adb shell cmd package query-activities -a android.intent.action.VIEW -d mailto:`
 *   -> com.google.android.gm/.ComposeActivityGmailExternal. The user asked to
 *   read a message and got a blank new-message screen. The launcher intent
 *   ACTION_MAIN + CATEGORY_APP_EMAIL resolves to the inbox itself
 *   (com.google.android.gm/.ConversationListActivityGmail), and React Native's
 *   JS API cannot set an intent category — hence the `Mailbox` native module.
 * - Desktop web: `mailto:` frequently resolves to nothing (no registered mail
 *   handler) or to a compose window in a client the user does not use. When the
 *   address belongs to a consumer provider we can name, its webmail URL in a new
 *   tab is strictly better; for company domains we cannot know, so the caller
 *   hides the affordance.
 * - iOS: `message://` opens Mail; `mailto:` is the fallback.
 *
 * Every step is best-effort and the screen never depends on it: the address, the
 * resend action and the sign-in escape hatch are all still on screen.
 */

export function canOpenMailbox(email: string): boolean {
  if (Platform.OS === "web") return webmailFor(email) !== null;
  return true; // native: the mail app is attempted, mailto: is the fallback
}

export function mailAppLabel(email: string): string | null {
  return Platform.OS === "web" ? (webmailFor(email)?.label ?? null) : null;
}

async function openExternally(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export async function openMailbox(email: string): Promise<boolean> {
  if (Platform.OS === "android") {
    const mailbox = (
      NativeModules as { Mailbox?: { openEmailApp?: () => Promise<boolean> } }
    ).Mailbox;
    if (mailbox?.openEmailApp) {
      try {
        await mailbox.openEmailApp();
        return true;
      } catch {
        // No app handles CATEGORY_APP_EMAIL (or the module failed): fall through
        // to the compose-style hand-off rather than doing nothing.
      }
    }
    return openExternally("mailto:");
  }

  if (Platform.OS === "ios") {
    if (await openExternally("message://")) return true;
    return openExternally("mailto:");
  }

  const webmail = webmailFor(email);
  if (!webmail) return false;
  if (typeof window !== "undefined") {
    window.open(webmail.url, "_blank", "noopener,noreferrer");
    return true;
  }
  return false;
}
