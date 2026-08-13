# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Libraries provide their own consumer rules. Avoid whole-library keeps here:
# they prevent R8 from removing unused APIs and are a major reason Play still
# sees library code that Proset never calls.

# Whisper uses name-based JNI entry points such as
# Java_ms_aifor_app_whisper_WhisperModule_nativeTranscribe.
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}

# Preserve metadata used by React Native modules and common serializers.
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes InnerClasses,EnclosingMethod
-keepattributes SourceFile,LineNumberTable
