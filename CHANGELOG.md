# Changelog

All notable changes to Proset will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Cycling waiting-state verbs**: conversions and the clarify modal now cycle random phase verbs ("Pondering…" / "Crafting…" / "Elucidating…") from three 20-word sets (EN + ES) while work runs. Visual-only — the accessibility label stays stable so screen readers announce each phase once. Backed by `lib/status-verbs.ts` + `lib/useCyclingStatus.ts`.
- **Fireworks AI provider**: new `fireworks` provider hosting DeepSeek V4 Flash, now the primary model for all regular-bucket conversions (same model, ~176 t/s output, lower first-token latency). Fallback chain degrades to official DeepSeek → Groq → OpenAI if Fireworks is unconfigured. Configured via `AI_FIREWORKS_API_KEY` (bound to Cloud Run through deploy.sh).
- **Bounded first-token timeout**: each provider attempt aborts after `AI_FIRST_TOKEN_TIMEOUT_MS` (default 20s) with no content, so a hung provider falls through to the next instead of stalling the conversion.
- **Faster simple conversions**: simple types skip learnings/history context lookups (less prefill, fewer storage round-trips).
- **Background recording (iOS)**: The active recording session now keeps running when the user navigates away from the Record screen or backgrounds the app on iOS. Backed by `UIBackgroundModes: ["audio"]` in `app.json` and `staysActiveInBackground: true` on the audio session while a recording is active. Completes the cross-platform background-recording rollout (web, Android, iOS) gated by the `persistentRecording` feature flag.
- **Crash/kill recovery for active recordings**: The provider now persists a minimal snapshot of the active recording lifecycle (`lib/active-recording-recovery.ts`) and detects orphaned state from a previous, force-quit session on next launch. Snapshots are scoped to the signed-in user, expire after 24 h, and are cleared on stop, discard, or user switch. Pure decision logic is covered by unit tests under `tests/lib/active-recording-recovery.test.ts`.

### Fixed
- **Jerky/stopped spinner on web**: the conversion + clarify spinners rotated via `Animated` with `useNativeDriver`, which react-native-web downgrades to the JS driver — streamed-chunk re-renders starved the rAF loop and froze the spinner. Web now uses a GPU-composited CSS keyframe animation (`proset-spin`) immune to re-renders; native unchanged.
- **Android release startup crash**: The release build was missing the Reanimated worklets Babel plugin (`react-native-worklets/plugin`), required by Reanimated 4. Without it, worklet bindings ran on the UI runtime as plain functions and threw a fatal `[Worklets] Only worklets can be executed synchronously on UI runtime` exception at launch, crashing the app before any UI rendered. Plugin restored in `babel.config.js`; verified on a release build (universal APK + Play split-APK install).
- **Missing icon glyphs on Android**: `react-native-vector-icons` fonts (Feather, FontAwesome, MaterialCommunityIcons) were never bundled into the native build, so every icon rendered as a "tofu" box. The `.ttf` files are now committed to `android/app/src/main/assets/fonts/` and package into both the APK and AAB.

### Changed
- **Version bump**: Android versionCode 6, versionName 1.0.9.

## [1.0.7] - 2026-06-28

### Fixed
- **Link previews on social platforms**: Root path `/` now serves the static landing page with full OG metadata instead of a 302 redirect to `/login`. WhatsApp, Telegram, Twitter, Facebook, and other platforms now display "Proset — Capture vital ideas and transform them" with a branded preview image when sharing `https://proset.ai`.
- **Landing page speed**: Static HTML landing page at `/` loads in ~130ms (previously redirected to SPA login).

### Changed
- **Deploy script**: `./scripts/deploy.sh gcr` now automatically pushes commits to GitLab (current branch + main) after deployment, triggering staging CI and GitHub mirror.
- **Version bump**: Android versionCode 3, versionName 1.0.7.

### Added
- **Open knowledge format**: Validated and completed `_devprocess/` documentation — business analysis, 4 ADRs accepted, arc42 completion, 45 Success Criteria across 11 feature specs.
- **E2E test**: New tester landing page spec.

## [1.0.6] - 2026-05-04

### Added
- **EAS OTA Updates**: Initialized and configured EAS Update (`expo-updates`) to allow for Over-The-Air JavaScript and UI updates without requiring a full App Store review.
- **RevenueCat Android MVP**: Provisioned the native Android app environment in RevenueCat (`Proset Android`) to securely link the `bun.proset.ai` package for subscription validation.

## [1.0.5] - 2026-04-30

### Fixed
- **Home Screen FAB Overlap**: Moved the floating "Record" button to the bottom-right of the screen and improved its background gradient to completely mask text scrolling behind it, resolving the issue of text bleeding into the button.

## [1.0.4] - 2026-04-29

### Fixed
- **Web Export Bug**: Hidden the "PDF (.pdf)" export option on the web platform, as it was improperly generating `.html` files and confusing users who expected a formatted document. The native ".docx" export option remains the standard for document export.

## [1.0.3] - 2026-04-29

### Removed
- **Send To AI Feature**: Completely removed the "Send To AI" feature and its associated modals from the recording interface, as it was unnecessary and created friction.
- **Add to Calendar**: Moved the "Add to Calendar" action out of the deprecated Send To menu and made it a direct button on the main action row for calendar event conversions.

## [1.0.2] - 2026-04-29

### Fixed
- **Record Screen Header Overlap**: Reduced the vertical spacing and margins inside the recording card to prevent it from pushing up and overlapping the top navigation bar on mobile viewports.

### Added
- **Record Button Idle Animation**: Added a subtle breathing scale animation and soft glow to the microphone button when idle to make it feel more interactive.
- **Timer Enhancements**: The recording timer now uses a monospace font to prevent text jitter as seconds tick, and features a glowing red effect during active recording.

## [1.0.1] - 2026-04-29

### Fixed
- **Home screen FAB overlap**: The floating record button at the bottom of the recordings list was visually merging with the last recording entry's text on mobile screens. Added a gradient scrim (fade-to-background overlay) behind the FAB and increased the list's bottom padding from 120px to 160px for clear visual separation. This follows the same pattern used by Google Keep, WhatsApp, and Spotify.

### Changed
- Restructured the FAB container in `app/index.tsx` to use a full-width wrapper with `LinearGradient` from `expo-linear-gradient` instead of a bare absolutely-positioned button.

## [1.0.0] - Initial Release

### Added
- Voice recording with real-time transcription
- AI-powered conversions (summaries, emails, action items, etc.)
- Multi-language support
- Cloud sync for paid plans
- User authentication with MFA support
- Subscription management via Stripe
- Search across recordings
- Dark mode UI with premium design
