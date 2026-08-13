#include <jni.h>
#include <string>
#include <thread>
#include <atomic>
#include "whisper.h"

static struct whisper_context *g_ctx = nullptr;
static std::atomic<bool> g_cancelled(false);

extern "C" {

JNIEXPORT jboolean JNICALL
Java_ms_aifor_app_whisper_WhisperModule_nativeLoadModel(
    JNIEnv *env, jobject /* this */, jstring modelPath) {
    const char *path = env->GetStringUTFChars(modelPath, nullptr);
    
    // Free existing model
    if (g_ctx) {
        whisper_free(g_ctx);
        g_ctx = nullptr;
    }
    
    struct whisper_context_params params = whisper_context_default_params();
    g_ctx = whisper_init_from_file_with_params(path, params);
    
    env->ReleaseStringUTFChars(modelPath, path);
    return g_ctx != nullptr ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jstring JNICALL
Java_ms_aifor_app_whisper_WhisperModule_nativeTranscribe(
    JNIEnv *env, jobject /* this */, jstring wavPath, jint maxDurationSec) {
    if (!g_ctx) {
        return env->NewStringUTF("");
    }
    
    const char *path = env->GetStringUTFChars(wavPath, nullptr);
    g_cancelled = false;
    
    struct whisper_full_params params = whisper_full_default_params(
        WHISPER_SAMPLING_GREEDY);
    params.print_progress = false;
    params.print_realtime = false;
    params.print_special = false;
    params.no_timestamps = true;
    params.single_segment = true;
    params.language = "en";
    params.max_len = 1;
    
    // Read WAV file
    std::vector<float> pcmf32;
    {
        // Use whisper's built-in WAV reader
        // Read the raw PCM data
        FILE *fp = fopen(path, "rb");
        if (!fp) {
            env->ReleaseStringUTFChars(wavPath, path);
            return env->NewStringUTF("");
        }
        
        // Skip WAV header (44 bytes for standard WAV)
        fseek(fp, 0, SEEK_END);
        long fileSize = ftell(fp);
        fseek(fp, 44, SEEK_SET); // skip header
        
        long dataSize = fileSize - 44;
        size_t numSamples = dataSize / 2; // 16-bit samples
        pcmf32.resize(numSamples);
        
        std::vector<int16_t> pcm16(numSamples);
        fread(pcm16.data(), sizeof(int16_t), numSamples, fp);
        fclose(fp);
        
        // Convert to float
        for (size_t i = 0; i < numSamples; i++) {
            pcmf32[i] = float(pcm16[i]) / 32768.0f;
        }
    }
    
    env->ReleaseStringUTFChars(wavPath, path);
    
    // Limit to maxDurationSec seconds (16000 samples/sec)
    size_t maxSamples = size_t(maxDurationSec) * WHISPER_SAMPLE_RATE;
    if (pcmf32.size() > maxSamples) {
        pcmf32.resize(maxSamples);
    }
    
    // Run inference
    std::string result;
    int ret = whisper_full(g_ctx, params, pcmf32.data(), pcmf32.size());
    
    if (ret == 0 && !g_cancelled) {
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
}

JNIEXPORT void JNICALL
Java_ms_aifor_app_whisper_WhisperModule_nativeCancel(
    JNIEnv *env, jobject /* this */) {
    g_cancelled = true;
}

JNIEXPORT void JNICALL
Java_ms_aifor_app_whisper_WhisperModule_nativeUnload(
    JNIEnv *env, jobject /* this */) {
    if (g_ctx) {
        whisper_free(g_ctx);
        g_ctx = nullptr;
    }
}

} // extern "C"
