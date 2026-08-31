#include <jni.h>
#include <string>
#include <vector>
#include <atomic>
#include <mutex>
#include <cstdio>
#include <cstring>
#include <memory>
#include "whisper.h"

// Saved JavaVM pointer for thread attachment safety
static JavaVM *g_vm = nullptr;

// Global whisper context, protected by g_mutex
static struct whisper_context *g_ctx = nullptr;
static std::atomic<bool> g_cancelled(false);
static std::mutex g_mutex;

// RAII wrapper for JNI GetStringUTFChars / ReleaseStringUTFChars to prevent string memory leaks
class ScopedUTFString {
public:
    ScopedUTFString(JNIEnv *env, jstring jstr)
        : m_env(env), m_jstr(jstr), m_chars(nullptr) {
        if (m_env && m_jstr) {
            m_chars = m_env->GetStringUTFChars(m_jstr, nullptr);
        }
    }

    ~ScopedUTFString() {
        if (m_env && m_jstr && m_chars) {
            m_env->ReleaseStringUTFChars(m_jstr, m_chars);
        }
    }

    ScopedUTFString(const ScopedUTFString &) = delete;
    ScopedUTFString &operator=(const ScopedUTFString &) = delete;

    const char *c_str() const { return m_chars; }
    bool valid() const { return m_chars != nullptr; }

private:
    JNIEnv *m_env;
    jstring m_jstr;
    const char *m_chars;
};

// RAII wrapper for FILE* resources
struct FileCloser {
    void operator()(FILE *fp) const {
        if (fp) {
            fclose(fp);
        }
    }
};
using ScopedFile = std::unique_ptr<FILE, FileCloser>;

// Helper for safe JVM thread attachment / detachment
struct JNIThreadScope {
    JNIEnv *env = nullptr;
    bool needsDetach = false;

    JNIThreadScope() {
        if (!g_vm) return;
        jint res = g_vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6);
        if (res == JNI_EDETACHED) {
            if (g_vm->AttachCurrentThread(&env, nullptr) == JNI_OK) {
                needsDetach = true;
            }
        }
    }

    ~JNIThreadScope() {
        if (needsDetach && g_vm) {
            g_vm->DetachCurrentThread();
        }
    }

    JNIThreadScope(const JNIThreadScope &) = delete;
    JNIThreadScope &operator=(const JNIThreadScope &) = delete;
};

extern "C" {

JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void * /* reserved */) {
    g_vm = vm;
    return JNI_VERSION_1_6;
}

JNIEXPORT jboolean JNICALL
Java_ms_aifor_app_whisper_WhisperModule_nativeLoadModel(
    JNIEnv *env, jobject /* this */, jstring modelPath) {
    if (!modelPath) {
        return JNI_FALSE;
    }

    ScopedUTFString pathStr(env, modelPath);
    if (!pathStr.valid()) {
        return JNI_FALSE;
    }

    try {
        std::lock_guard<std::mutex> lock(g_mutex);

        // Free existing model
        if (g_ctx) {
            whisper_free(g_ctx);
            g_ctx = nullptr;
        }

        struct whisper_context_params params = whisper_context_default_params();
        g_ctx = whisper_init_from_file_with_params(pathStr.c_str(), params);

        return g_ctx != nullptr ? JNI_TRUE : JNI_FALSE;
    } catch (...) {
        return JNI_FALSE;
    }
}

JNIEXPORT jstring JNICALL
Java_ms_aifor_app_whisper_WhisperModule_nativeTranscribe(
    JNIEnv *env, jobject /* this */, jstring wavPath, jint maxDurationSec) {
    if (!wavPath) {
        return env->NewStringUTF("");
    }

    ScopedUTFString pathStr(env, wavPath);
    if (!pathStr.valid()) {
        return env->NewStringUTF("");
    }

    try {
        std::lock_guard<std::mutex> lock(g_mutex);

        if (!g_ctx) {
            return env->NewStringUTF("");
        }

        g_cancelled.store(false);

        struct whisper_full_params params = whisper_full_default_params(
            WHISPER_SAMPLING_GREEDY);
        params.print_progress = false;
        params.print_realtime = false;
        params.print_special = false;
        params.no_timestamps = true;
        params.single_segment = true;
        params.language = "en";
        params.max_len = 1;

        params.abort_callback = [](void * /* user_data */) -> bool {
            return g_cancelled.load();
        };
        params.abort_callback_user_data = nullptr;

        // Read WAV file
        std::vector<float> pcmf32;
        {
            ScopedFile fp(fopen(pathStr.c_str(), "rb"));
            if (!fp) {
                return env->NewStringUTF("");
            }

            if (fseek(fp.get(), 0, SEEK_END) != 0) {
                return env->NewStringUTF("");
            }

            long fileSize = ftell(fp.get());
            if (fileSize <= 44) {
                return env->NewStringUTF("");
            }

            if (fseek(fp.get(), 44, SEEK_SET) != 0) {
                return env->NewStringUTF("");
            }

            long dataSize = fileSize - 44;
            size_t numSamples = static_cast<size_t>(dataSize) / sizeof(int16_t);
            if (numSamples == 0) {
                return env->NewStringUTF("");
            }

            size_t maxSamples = (maxDurationSec > 0)
                ? static_cast<size_t>(maxDurationSec) * WHISPER_SAMPLE_RATE
                : numSamples;
            if (numSamples > maxSamples) {
                numSamples = maxSamples;
            }

            std::vector<int16_t> pcm16(numSamples);
            size_t samplesRead = fread(pcm16.data(), sizeof(int16_t), numSamples, fp.get());
            if (samplesRead == 0) {
                return env->NewStringUTF("");
            }

            pcmf32.resize(samplesRead);
            for (size_t i = 0; i < samplesRead; i++) {
                pcmf32[i] = static_cast<float>(pcm16[i]) / 32768.0f;
            }
        }

        if (pcmf32.empty()) {
            return env->NewStringUTF("");
        }

        // Run inference
        std::string result;
        int ret = whisper_full(g_ctx, params, pcmf32.data(), static_cast<int>(pcmf32.size()));

        if (ret == 0 && !g_cancelled.load()) {
            int n_segments = whisper_full_n_segments(g_ctx);
            for (int i = 0; i < n_segments; i++) {
                const char *text = whisper_full_get_segment_text(g_ctx, i);
                if (text && strlen(text) > 0) {
                    if (!result.empty()) result += " ";
                    result += text;
                }
            }
        }

        return env->NewStringUTF(result.c_str());
    } catch (...) {
        return env->NewStringUTF("");
    }
}

JNIEXPORT void JNICALL
Java_ms_aifor_app_whisper_WhisperModule_nativeCancel(
    JNIEnv * /* env */, jobject /* this */) {
    g_cancelled.store(true);
}

JNIEXPORT void JNICALL
Java_ms_aifor_app_whisper_WhisperModule_nativeUnload(
    JNIEnv * /* env */, jobject /* this */) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_ctx) {
        whisper_free(g_ctx);
        g_ctx = nullptr;
    }
}

} // extern "C"
