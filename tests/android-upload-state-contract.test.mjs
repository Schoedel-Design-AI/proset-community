import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const worker = read(
  "android/app/src/main/java/ms/aifor/app/upload/UploadWorker.kt",
);
const workerModule = read(
  "android/app/src/main/java/ms/aifor/app/upload/UploadWorkerModule.kt",
);
const tokenProvider = read(
  "android/firebase-token-provider/src/main/java/ms/aifor/app/upload/FirebaseTokenProvider.java",
);
const workerClient = read("lib/upload-worker.ts");
const recordingScreen = read("app/recording/[id].tsx");
const routes = read("server/modules/recordings/router.ts");
const androidBuild = read("android/app/build.gradle");
const tokenProviderBuild = read("android/firebase-token-provider/build.gradle");
const workerFailureInstrumentation = read(
  "android/app/src/androidTest/java/ms/aifor/app/upload/UploadWorkerFailureTest.java",
);
const firebasePackage = JSON.parse(
  read("node_modules/@react-native-firebase/app/package.json"),
);

test("background worker obtains a current Firebase token and force refreshes once after 401", () => {
  assert.match(tokenProvider, /FirebaseAuth\.getInstance\(\)\.getCurrentUser\(\)/);
  assert.match(tokenProvider, /user\.getIdToken\(forceRefresh\)/);
  assert.match(tokenProvider, /CompletableFuture<String>/);
  assert.match(worker, /FirebaseTokenProvider\.getToken/);
  assert.match(
    worker,
    /responseCode == HttpURLConnection\.HTTP_UNAUTHORIZED[\s\S]*?forceRefresh = true[\s\S]*?uploadFile\(/,
  );
  assert.match(
    worker,
    /requestStoredTranscriptionWithRefresh[\s\S]*?HTTP_UNAUTHORIZED[\s\S]*?forceRefresh = true/,
  );
  assert.match(worker, /legacy-auth fallback during Firebase cutover/);
  const firebaseBom = firebasePackage.sdkVersions.android.firebase;
  assert.match(
    tokenProviderBuild,
    new RegExp(
      `firebase-bom:${firebaseBom.replaceAll(".", "\\.")}`,
    ),
  );
  assert.match(
    tokenProviderBuild,
    /implementation\("com\.google\.firebase:firebase-auth"\)/,
  );
  assert.match(
    androidBuild,
    /implementation\(project\(":firebase-token-provider"\)\)/,
  );
  assert.doesNotMatch(androidBuild, /com\.google\.firebase:firebase-auth/);
});

test("WorkManager retries are bounded and publish terminal output data", () => {
  assert.match(worker, /const val MAX_RUN_ATTEMPTS = 4/);
  assert.match(worker, /runAttemptCount \+ 1 < MAX_RUN_ATTEMPTS/);
  assert.match(worker, /Result\.retry\(\)/);
  assert.match(worker, /Result\.failure\([\s\S]*?KEY_ERROR_CODE[\s\S]*?KEY_RETRYABLE/);
  assert.match(worker, /ExistingWorkPolicy\.KEEP/);
  assert.doesNotMatch(worker, /ExistingWorkPolicy\.REPLACE/);
});

test("React Native reads local WorkInfo failure independently of the server", () => {
  assert.match(workerModule, /getWorkInfosForUniqueWork/);
  assert.match(workerModule, /info\.outputData/);
  assert.match(workerModule, /putString\("errorCode"/);
  assert.match(workerClient, /getBackgroundUploadStatus/);
  assert.match(
    recordingScreen,
    /Promise\.all\(\[[\s\S]*?fetchRecording\(recording\.id\)[\s\S]*?getBackgroundUploadStatus\(recording\.id\)/,
  );
  assert.match(
    recordingScreen,
    /recording\.transcriptionStatus === "queued"[\s\S]*?recording\.transcriptionStatus === "transcribing"/,
  );
});

test("server persists independent upload and transcription lifecycles", () => {
  assert.match(routes, /uploadStatus: "uploading"/);
  assert.match(routes, /uploadStatus: "uploaded"/);
  assert.match(routes, /uploadStatus: "failed"/);
  assert.match(routes, /transcriptionStatus: "transcribing"/);
  assert.match(routes, /transcriptionStatus: "succeeded"/);
  assert.match(routes, /transcriptionStatus: "failed"/);
});

test("web upload path publishes the same explicit lifecycle contract", () => {
  assert.match(
    recordingScreen,
    /uploadStatus: "uploaded"[\s\S]*?transcriptionStatus: "queued"/,
  );
  assert.match(recordingScreen, /uploadStatus: "failed"/);
  assert.match(recordingScreen, /uploadErrorCode: "upload_failed"/);
});

test("device instrumentation observes terminal WorkInfo output from the real worker", () => {
  assert.match(workerFailureInstrumentation, /WorkManager\.getInstance/);
  assert.match(workerFailureInstrumentation, /WorkInfo\.State\.FAILED/);
  assert.match(workerFailureInstrumentation, /upload_file_missing/);
  assert.match(
    workerFailureInstrumentation,
    /getOutputData\(\)\.getBoolean\(UploadWorker\.KEY_RETRYABLE, true\)/,
  );
});
