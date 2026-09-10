import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("product code does not use the removed StyleSheet.absoluteFillObject API", () => {
  const navigationDrawer = read("components/NavigationDrawer.tsx");
  const recordings = read("app/recordings.tsx");

  assert.doesNotMatch(navigationDrawer, /StyleSheet\.absoluteFillObject/);
  assert.doesNotMatch(recordings, /StyleSheet\.absoluteFillObject/);
  assert.match(
    navigationDrawer,
    /position:\s*"absolute"[\s\S]*top:\s*0[\s\S]*right:\s*0[\s\S]*bottom:\s*0[\s\S]*left:\s*0/,
  );
  assert.match(recordings, /style=\{StyleSheet\.absoluteFill\}/);
});

test("Reanimated keeps the bare React Native Worklets plugin last", () => {
  const babelConfig = read("babel.config.js");
  const pluginPosition = babelConfig.lastIndexOf('"react-native-worklets/plugin"');

  assert.notEqual(pluginPosition, -1);
  assert.doesNotMatch(
    babelConfig.slice(pluginPosition + '"react-native-worklets/plugin"'.length),
    /["'][^"']+\/plugin["']/,
  );
});

test("React Native 0.86 dependencies stay on the approved New Architecture set", () => {
  const packageJson = JSON.parse(read("package.json"));
  const packageLock = JSON.parse(read("package-lock.json"));

  assert.equal(packageJson.dependencies.react, "19.2.7");
  assert.equal(packageJson.dependencies["react-dom"], "19.2.7");
  assert.equal(packageJson.dependencies["react-native"], "0.86.3");
  assert.equal(packageJson.dependencies["react-native-reanimated"], "4.5.3");
  assert.equal(packageJson.dependencies["react-native-worklets"], "0.11.3");
  assert.equal(packageJson.dependencies["react-native-nitro-modules"], "0.36.3");
  assert.equal(packageJson.dependencies["@shopify/react-native-skia"], "2.10.1");
  assert.equal(packageJson.dependencies["react-native-purchases"], "10.5.0");
  assert.equal(packageJson.dependencies["react-native-purchases-ui"], "10.5.0");
  assert.equal(packageJson.dependencies["react-native-safe-area-context"], "5.8.0");
  assert.equal(packageJson.dependencies["react-native-screens"], "4.26.2");
  assert.equal(packageJson.devDependencies["@react-native-community/cli"], "20.2.0");
  assert.equal(packageJson.devDependencies["@react-native/babel-preset"], "0.86.3");
  assert.equal(packageJson.devDependencies["@react-native/metro-config"], "0.86.3");
  assert.equal(packageLock.packages["node_modules/metro"].version, "0.84.5");
  assert.equal(
    packageLock.packages["node_modules/metro"].dependencies["image-size"],
    undefined,
  );
});

test("Vite validates Reanimated compatibility while keeping Worklets unbundled", () => {
  const viteConfig = read("vite.config.mts");
  const browserValidator = read(
    "lib/validate-reanimated-worklets-version.web.ts",
  );

  assert.match(
    viteConfig,
    /exclude:\s*\/\\\/node_modules\\\/\(\?!react-native-worklets/,
  );
  assert.match(
    viteConfig,
    /exclude:\s*\[[\s\S]*"react-native-worklets"/,
  );
  assert.doesNotMatch(
    viteConfig,
    /exclude:\s*\[[\s\S]*"react-native-reanimated"/,
  );
  assert.match(viteConfig, /validateWorkletsVersion\(reanimatedPackage\.version\)/);
  assert.match(
    viteConfig,
    /react-native-reanimated\\\/scripts\\\/validate-worklets-version/,
  );
  assert.match(browserValidator, /return \{ ok: true \} as const/);
});

test("Android native bootstrap follows the RN 0.86 ReactHost-only template", () => {
  const rootBuild = read("android/build.gradle");
  const appBuild = read("android/app/build.gradle");
  const properties = read("android/gradle.properties");
  const wrapper = read("android/gradle/wrapper/gradle-wrapper.properties");
  const application = read(
    "android/app/src/main/java/ms/aifor/app/MainApplication.kt",
  );
  const activity = read(
    "android/app/src/main/java/ms/aifor/app/MainActivity.kt",
  );

  assert.match(rootBuild, /buildToolsVersion = "36\.0\.0"/);
  assert.match(rootBuild, /ndkVersion = "27\.1\.12297006"/);
  assert.match(rootBuild, /kotlinVersion = "2\.1\.20"/);
  assert.match(appBuild, /ndkVersion = rootProject\.ext\.ndkVersion/);
  assert.match(appBuild, /buildToolsVersion = rootProject\.ext\.buildToolsVersion/);
  assert.match(wrapper, /gradle-9\.3\.1-bin\.zip/);
  assert.match(application, /DefaultReactHost\.getDefaultReactHost/);
  assert.match(application, /override val reactHost: ReactHost by lazy/);
  assert.match(application, /RecordingForegroundPackage/);
  assert.match(application, /UploadWorkerPackage/);
  assert.match(application, /WhisperPackage/);
  assert.doesNotMatch(application, /ReactNativeHost|DefaultReactNativeHost/);
  assert.match(activity, /RNScreensFragmentFactory/);
  assert.match(activity, /super\.onCreate\(savedInstanceState\)/);
  assert.doesNotMatch(properties, /(?:^|\n)(?:expo\.|EX_DEV_CLIENT_)/);
  assert.match(properties, /^android\.useLegacyPackaging=false$/m);
  assert.match(properties, /^android\.fresco\.gifEnabled=true$/m);
});

test("Proset native modules use the current lazy package and foreground APIs", () => {
  const packagePaths = [
    "android/app/src/main/java/ms/aifor/app/recording/RecordingForegroundPackage.kt",
    "android/app/src/main/java/ms/aifor/app/upload/UploadWorkerPackage.kt",
    "android/app/src/main/java/ms/aifor/app/whisper/WhisperPackage.kt",
  ];
  for (const path of packagePaths) {
    const source = read(path);
    assert.match(source, /BaseReactPackage/);
    assert.match(source, /override fun getModule/);
    assert.match(source, /getReactModuleInfoProvider/);
    assert.doesNotMatch(source, /createNativeModules|ReactPackage\s*\{/);
  }

  const service = read(
    "android/app/src/main/java/ms/aifor/app/recording/RecordingForegroundService.kt",
  );
  assert.match(service, /stopForeground\(STOP_FOREGROUND_REMOVE\)/);
  assert.doesNotMatch(service, /stopForeground\(true\)/);
});
