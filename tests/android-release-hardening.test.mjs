import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));
const sha256 = (path) =>
  createHash("sha256")
    .update(readFileSync(new URL(`../${path}`, import.meta.url)))
    .digest("hex");

test("Android release is adaptive, edge-to-edge, and R8 optimized", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const layout = read("app/_layout.tsx");
  const properties = read("android/gradle.properties");
  const build = read("android/app/build.gradle");
  const styles = read("android/app/src/main/res/values/styles.xml");
  const settings = read("android/settings.gradle");
  const rules = read("android/app/proguard-rules.pro");
  const packageJson = JSON.parse(read("package.json"));

  assert.doesNotMatch(manifest, /screenOrientation=/);
  assert.doesNotMatch(manifest, /resizeableActivity=/);
  assert.doesNotMatch(manifest, /enableOnBackInvokedCallback="false"/);
  assert.match(
    manifest,
    /READ_EXTERNAL_STORAGE"[\s\S]*?tools:node="remove"/,
  );
  assert.match(
    manifest,
    /WRITE_EXTERNAL_STORAGE"[\s\S]*?tools:node="remove"/,
  );
  assert.doesNotMatch(layout, /<StatusBar[^>]+(?:backgroundColor|translucent)/);
  assert.doesNotMatch(
    styles,
    /statusBarColor|navigationBarColor|windowLightStatusBar|windowLightNavigationBar/,
  );
  assert.match(properties, /^edgeToEdgeEnabled=true$/m);
  assert.doesNotMatch(properties, /^expo\.edgeToEdgeEnabled=/m);
  assert.match(properties, /^android\.enableMinifyInReleaseBuilds=true$/m);
  assert.match(properties, /^android\.enableShrinkResourcesInReleaseBuilds=true$/m);
  assert.match(properties, /^android\.r8\.optimizedResourceShrinking=true$/m);
  assert.match(build, /proguard-android-optimize\.txt/);
  assert.match(build, /com\.google\.android\.material:material:1\.14\.0/);
  assert.match(build, /androidx\.work:work-runtime-ktx:2\.11\.2/);
  assert.doesNotMatch(
    settings,
    /includeBuild\(new File\(rootDir, "\.\.\/node_modules\/react-native"\)\)/,
  );
  assert.doesNotMatch(rules, /-keep class (?:com\.facebook\.react|okhttp3)\.\*\*/);
  assert.equal(packageJson.dependencies["react-native"], "0.86.2");
  assert.equal(packageJson.dependencies["react-native-screens"], "4.26.2");
  assert.equal(packageJson.dependencies["react-native-keyboard-controller"], "1.22.2");
});

test("RN 0.86 uses the published artifact and retains only the keyboard edge patch", () => {
  const settings = read("android/settings.gradle");
  const keyboardPatch = read("patches/react-native-keyboard-controller+1.22.2.patch");

  assert.equal(exists("patches/react-native+0.81.5.patch"), false);
  assert.doesNotMatch(
    settings,
    /includeBuild\(new File\(rootDir, "\.\.\/node_modules\/react-native"\)\)/,
  );
  assert.match(keyboardPatch, /StatusBarManagerCompatModuleImpl\.kt/);
  assert.doesNotMatch(
    read(
      "node_modules/react-native-keyboard-controller/android/src/main/java/com/reactnativekeyboardcontroller/modules/statusbar/StatusBarManagerCompatModuleImpl.kt",
    ),
    /\.statusBarColor|statusBarColor\s*=/,
  );
});

test("Android upload requires and publishes the R8 mapping", () => {
  const buildScript = read("scripts/build-android.sh");
  const uploadScript = read("scripts/upload-aab.py");
  const edgeAudit = read("scripts/audit-android-edge-to-edge.py");

  assert.match(buildScript, /outputs\/mapping\/release\/mapping\.txt/);
  assert.match(buildScript, /R8 mapping file missing or empty/);
  assert.match(buildScript, /audit-android-edge-to-edge\.py/);
  assert.match(buildScript, /PUBLIC_ENV_FINGERPRINT/);
  assert.match(buildScript, /-PaiformsPublicFingerprint=/);
  assert.match(
    buildScript,
    /compileSdk = rootProject\.ext\.compileSdkVersion/,
  );
  assert.match(
    read("android/app/build.gradle"),
    /inputs\.property\("aiformsPublicFingerprint"/,
  );
  assert.match(edgeAudit, /base\/dex\//);
  assert.match(edgeAudit, /FATAL_PREFIXES/);
  assert.match(edgeAudit, /APPROVED_RN_086_CALLS/);
  assert.match(edgeAudit, /R8_METHOD_MAPPING_RE/);
  assert.match(edgeAudit, /verify_rn_086_source_contract/);
  assert.match(edgeAudit, /verify_screens_source_contract/);
  assert.match(uploadScript, /deobfuscationfiles\(\)\.upload/);
  assert.match(uploadScript, /deobfuscationFileType="proguard"/);
});

test("Android recording and document imports use maintained native modules", () => {
  const packageJson = JSON.parse(read("package.json"));
  const audio = read("lib/audio.ts");
  const recordingContext = read("lib/active-recording-context.tsx");
  const fileSystem = read("lib/file-system.ts");
  const whisper = read("lib/whisper.ts");
  const documentPicker = read("lib/document-picker.ts");
  const documentPickerCompat = read("lib/expo-document-picker.ts");
  const navigation = read("lib/navigation.tsx");
  const uploadWorker = read(
    "android/app/src/main/java/ms/aifor/app/upload/UploadWorker.kt",
  );
  const uploadMetadata = read("lib/audio-upload-metadata.ts");

  assert.equal(packageJson.dependencies["react-native-nitro-sound"], "0.2.15");
  assert.equal(packageJson.dependencies["@react-native-documents/picker"], "12.0.2");
  assert.equal(packageJson.dependencies["react-native-file-access"], "4.0.3");
  assert.equal(packageJson.dependencies["react-native-fs"], undefined);
  assert.equal(packageJson.dependencies["@react-navigation/native"], "7.3.14");
  assert.equal(packageJson.dependencies["@react-navigation/native-stack"], "7.18.6");
  assert.equal(packageJson.dependencies["@react-navigation/stack"], undefined);
  assert.equal(packageJson.dependencies["react-native-gesture-handler"], undefined);
  assert.equal(packageJson.dependencies["@react-native-vector-icons/feather"], "13.1.2");
  assert.equal(
    packageJson.dependencies["@react-native-vector-icons/fontawesome"],
    "13.1.2",
  );
  assert.equal(packageJson.dependencies["react-native-vector-icons"], undefined);
  assert.equal(packageJson.dependencies["react-native-audio-recorder-player"], undefined);
  assert.equal(packageJson.dependencies["react-native-document-picker"], undefined);
  assert.match(audio, /createSound\(\)/);
  assert.match(audio, /react-native-file-access/);
  assert.match(audio, /recording-\$\{Date\.now\(\)\}\.m4a/);
  assert.match(audio, /OutputFormatAndroidType\.MPEG_4/);
  assert.match(audio, /AudioEncoderAndroidType\.AAC/);
  assert.match(audio, /async resumeAsync\(\)/);
  assert.match(recordingContext, /recordingRef\.current\.resumeAsync\(\)/);
  assert.match(recordingContext, /FileSystem\.exists/);
  assert.match(fileSystem, /Dirs\.(?:CacheDir|DocumentDir)/);
  assert.match(fileSystem, /FileSystem\.(?:readFile|writeFile)/);
  assert.match(whisper, /FileSystem\.fetchManaged/);
  assert.match(whisper, /FileSystem\.unlink/);
  assert.match(documentPicker, /@react-native-documents\/picker/);
  assert.match(documentPicker, /keepLocalCopy/);
  assert.match(documentPickerCompat, /from "\.\/document-picker"/);
  assert.match(navigation, /@react-navigation\/native-stack/);
  assert.match(navigation, /createNativeStackNavigator/);
  assert.match(uploadWorker, /file\.extension\.lowercase\(\)/);
  assert.match(uploadWorker, /"recording\.m4a" to "audio\/mp4"/);
  assert.match(uploadMetadata, /\.wav/);
  assert.match(uploadMetadata, /\.m4a/);
  assert.doesNotMatch(audio, /react-native-audio-recorder-player/);
  assert.doesNotMatch(fileSystem, /react-native-fs/);
  assert.doesNotMatch(documentPicker, /react-native-document-picker/);
});

test("scoped vector icon fonts are bundled exactly once and match their packages", () => {
  assert.equal(
    sha256("node_modules/@react-native-vector-icons/feather/fonts/Feather.ttf"),
    sha256("android/app/src/main/assets/fonts/Feather.ttf"),
  );
  assert.equal(
    sha256("node_modules/@react-native-vector-icons/fontawesome/fonts/FontAwesome.ttf"),
    sha256("android/app/src/main/assets/fonts/FontAwesome.ttf"),
  );
  assert.equal(
    exists("android/app/src/main/assets/fonts/MaterialCommunityIcons.ttf"),
    false,
  );
});

test("strict npm resolution and maintained PDF generation replace legacy printing", () => {
  const packageJson = JSON.parse(read("package.json"));
  const recordingScreen = read("app/recording/[id].tsx");
  const routes = read("server/routes.ts");
  const pdfGenerator = read("server/pdf-generator.ts");

  assert.equal(packageJson.devDependencies["@types/react-dom"], "19.2.4");
  assert.equal(packageJson.dependencies["react-native-print"], undefined);
  assert.match(routes, /\/api\/generate-pdf", requireAuth/);
  assert.match(pdfGenerator, /new PDFDocument/);
  assert.match(recordingScreen, /\/api\/generate-pdf/);
  assert.doesNotMatch(recordingScreen, /@\/lib\/print/);
});

test("Office Kit powers bounded XLSX ingestion and workbook output", () => {
  const packageJson = JSON.parse(read("package.json"));
  const documentParser = read("server/document-parser.ts");
  const spreadsheetService = read("server/spreadsheet-service.ts");
  const recordingScreen = read("app/recording/[id].tsx");
  const routes = read("server/routes.ts");

  assert.equal(packageJson.dependencies["@office-kit/xlsx"], "0.9.0");
  assert.equal(packageJson.dependencies.exceljs, undefined);
  assert.match(documentParser, /loadWorkbookStream/);
  assert.match(documentParser, /MAX_SPREADSHEET_ROWS/);
  assert.match(documentParser, /MAX_SPREADSHEET_CELLS/);
  assert.match(documentParser, /workbook\.close/);
  assert.doesNotMatch(documentParser, /ExcelJS|from ["']exceljs["']/);
  assert.match(spreadsheetService, /generateSpreadsheetXlsx/);
  assert.match(spreadsheetService, /workbookToBuffer/);
  assert.match(routes, /\/api\/generate-xlsx", requireAuth/);
  assert.match(recordingScreen, /\/api\/generate-xlsx/);
});
