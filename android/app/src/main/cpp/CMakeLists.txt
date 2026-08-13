cmake_minimum_required(VERSION 3.18.1)
project("whisper_jni")

# Build whisper.cpp as a subdirectory (handles ggml internally)
set(WHISPER_DIR ${CMAKE_CURRENT_SOURCE_DIR}/whisper.cpp)

# Disable examples, tests, and other unused targets
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "")
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "")
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "")

# Configure ggml for CPU-only ARM64
set(GGML_CPU_ARM_ARCH "armv8.2-a" CACHE STRING "")
set(GGML_CPU_ALL_VARIANTS OFF CACHE BOOL "")

add_subdirectory(${WHISPER_DIR} whisper_build)

# JNI bridge
add_library(whisper-jni SHARED whisper-jni.cpp)
target_link_libraries(whisper-jni whisper ggml log)
target_include_directories(whisper-jni PRIVATE
    ${WHISPER_DIR}/include
)
