import { NativeModules, Platform, Alert } from "react-native";
import { getCurrentLanguage } from "./i18n";

const PermissionsAndroid = Platform.OS === "android" ? require("react-native").PermissionsAndroid : null;

/**
 * Thin JS wrapper around the Android-only `BarryRecordingForegroundService`
 * native module (see `plugins/withRecordingForegroundService.js`). Used by
 * `ActiveRecordingProvider` to keep mic capture alive while the app is
 * backgrounded.
 *
 * Web and iOS get no-op implementations so callers can stay platform-agnostic.
 * iOS does not need a foreground service: it keeps recording alive in the
 * background via the `audio` entry in `UIBackgroundModes` (declared in
 * `app.json`) combined with `staysActiveInBackground: true` on the
 * `expo-av` audio session while a recording is active. See
 * `lib/active-recording-context.tsx`.
 */

export interface RecordingNotificationCopy {
  title: string;
  body: string;
  channelName: string;
}

type NativeFgs = {
  start: (title: string, content: string) => void;
  update: (title: string, content: string) => void;
  stop: () => void;
};

const native: NativeFgs | null =
  Platform.OS === "android"
    ? ((NativeModules as { RecordingForeground?: NativeFgs })
        .RecordingForeground ?? null)
    : null;

async function safe<T>(fn: () => Promise<T>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    // Swallow — the recording itself can continue regardless of whether the
    // notification call succeeded. Surfacing this would just add noise to a
    // recording happy path the user is already monitoring on screen.
    console.warn("[recording-fgs] native call failed:", err);
  }
}

/**
 * Show a pre-permission explanation dialog BEFORE the system notification
 * permission prompt. Users should understand WHY we're asking and what
 * they lose by saying no — no dark-pattern ambush.
 */
function requestNotificationPermissionWithExplanation(): Promise<boolean> {
  return new Promise((resolve) => {
    // Bilingual — read current language preference
    const isSpanish = getCurrentLanguage() === "es";
    const title = isSpanish
      ? "¿Mantener la grabación en segundo plano?"
      : "Keep recording in the background?";
    const message = isSpanish
      ? "Proset usa una notificación para mantener tu grabación activa cuando cambias de app o bloqueas la pantalla. Sin ella, la grabación se detiene al salir de la app.\n\nPuedes cambiar esto en cualquier momento en Configuración."
      : "Proset uses a notification to keep your recording alive when you switch apps or lock your screen. Without it, recording stops if you leave the app.\n\nYou can change this anytime in Settings.";
    const cancelText = isSpanish ? "Ahora no" : "Not now";
    const okText = isSpanish ? "Activar" : "Enable";
    Alert.alert(
      title,
      message,
      [
        { text: cancelText, style: "cancel", onPress: () => resolve(false) },
        { text: okText, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

async function ensureNotificationPermission(): Promise<void> {
  if (Platform.OS !== "android") return;
  // POST_NOTIFICATIONS runtime permission was added in API level 33.
  const apiLevel =
    typeof Platform.Version === "number"
      ? Platform.Version
      : parseInt(String(Platform.Version), 10);
  if (!Number.isFinite(apiLevel) || apiLevel < 33) return;

  const perm = (
    PermissionsAndroid.PERMISSIONS as Record<string, string | undefined>
  ).POST_NOTIFICATIONS;
  if (!perm) return;

  // Already granted — never re-prompt (the explanation dialog must not appear
  // on every recording start once the user has decided).
  try {
    if (await PermissionsAndroid.check(perm as Parameters<typeof PermissionsAndroid.check>[0])) {
      return;
    }
  } catch {
    // Fall through to the prompt flow on check failure.
  }

  // Show pre-permission explanation first, so the user knows why
  const userWantsNotifications = await requestNotificationPermissionWithExplanation();
  if (!userWantsNotifications) return;

  try {
    await PermissionsAndroid.request(
      perm as Parameters<typeof PermissionsAndroid.request>[0],
    );
  } catch {
    // Ignore — the service still starts and records audio even without
    // notification permission; the user just won't see a notification.
  }
}

export const recordingForegroundService = {
  /** `true` only on Android when the native module has been linked. */
  isSupported: native != null,

  async start(copy: RecordingNotificationCopy): Promise<void> {
    if (!native) return;
    await ensureNotificationPermission();
    await safe(() => Promise.resolve(native.start(copy.title, copy.body)));
  },

  async update(copy: RecordingNotificationCopy): Promise<void> {
    if (!native) return;
    await safe(() => Promise.resolve(native.update(copy.title, copy.body)));
  },

  async stop(): Promise<void> {
    if (!native) return;
    await safe(() => Promise.resolve(native.stop()));
  },
};
