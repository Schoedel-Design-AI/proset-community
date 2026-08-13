import { Platform } from "react-native";

/**
 * Repository-wide feature flags.
 *
 * Keep this module dependency-free (besides react-native's Platform) so it can
 * be safely imported from anywhere — providers, screens, tests — without
 * pulling in side effects.
 *
 * Flags should be plain booleans whose value is resolved once at module load
 * (or per call for those that need to react to env). Avoid coupling flags to
 * runtime state.
 */
export const featureFlags = {
  /**
   * When enabled, the `ActiveRecordingProvider` keeps the active recording
   * session alive across navigation between routes (i.e. the recording
   * survives when the user leaves `/record`). When disabled, the provider
   * mirrors the legacy `app/record.tsx` semantics and the active recording
   * is discarded as soon as the Record screen unmounts.
   *
   * Rollout (per the background-recording plan):
   *   web      -> ON   (step 1)
   *   android  -> ON   (step 3 — backed by a foreground service;
   *                     see `lib/recording-foreground-service.ts` and
   *                     `plugins/withRecordingForegroundService.js`)
   *   ios      -> ON   (step 4, this change — backed by the `audio`
   *                     `UIBackgroundModes` entry in `app.json` and
   *                     `staysActiveInBackground: true` on the audio
   *                     session while a recording is active; iOS has no
   *                     foreground-service equivalent.)
   */
  persistentRecording:
    Platform.OS === "web" || Platform.OS === "android" || Platform.OS === "ios",
} as const;

export type FeatureFlagName = keyof typeof featureFlags;
