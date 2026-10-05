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

# react-native-html-to-pdf -> com.tom-roush:pdfbox-android:2.0.27.0.
# PDFBox's JPXFilter (JPEG2000 image support) references the optional decoder
# com.gemalto.jp2.JP2Decoder. That artifact is no longer published (Gemalto was
# absorbed and com.gemalto.jp2:jp2-android left Maven Central), and JPX images
# never appear in the HTML we print, so the JPX path is unreachable at runtime.
# Without this, R8 full mode fails the release build with
# "Missing class com.gemalto.jp2.JP2Decoder" at :app:minifyReleaseWithR8.
-dontwarn com.gemalto.jp2.**

