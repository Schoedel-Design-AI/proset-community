# Custom app-level CMake entry point.
#
# CRITICAL: with newArchEnabled=true, React Native's gradle plugin injects its
# default CMakeLists (which builds libappmodules.so — the library that registers
# every autolinked TurboModule) ONLY when no custom externalNativeBuild path is
# set. Any custom CMakeLists here MUST include ReactNative-application.cmake or
# the app crashes on open with:
#   TurboModuleRegistry.getEnforcing('PlatformConstants') could not be found
#
# NOTE: this directory must contain NO *.cpp files — ReactNative-application.cmake
# globs *.cpp next to it as an OnLoad.cpp override. Keeping it empty makes RN use
# its default OnLoad.cpp.

cmake_minimum_required(VERSION 3.13)
project(appmodules)

# React Native New Architecture default app setup (builds libappmodules.so)
include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

# --- On-device Whisper transcription (libwhisper-jni.so) ---
# whisper.cpp is tuned for ARM64 only; other ABIs skip it and WhisperModule.kt
# degrades gracefully (System.loadLibrary guard).
if(ANDROID_ABI STREQUAL "arm64-v8a")
    add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../cpp whisper_jni_build)
endif()
