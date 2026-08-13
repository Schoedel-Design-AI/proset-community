import { Platform } from "react-native";

export namespace Audio {
  export interface RecordingStatus {
    isRecording: boolean;
    metering?: number;
    isDoneRecording?: boolean;
  }

  export interface SoundStatus {
    isLoaded: boolean;
    positionMillis: number;
    durationMillis: number;
    isPlaying: boolean;
    didJustFinish?: boolean;
  }

  export async function requestPermissionsAsync() {
    if (Platform.OS === "web") {
      try {
        // Use the Permissions API to check mic status without activating the
        // microphone. Activating it via getUserMedia interrupts audio routing
        // (e.g., headphones briefly route through the device speaker).
        if (typeof navigator !== "undefined" && navigator.permissions) {
          const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
          return { granted: result.state !== "denied" };
        }
        // Permissions API not available — assume granted; getUserMedia will
        // gate access when the user actually starts recording.
        return { granted: true };
      } catch {
        return { granted: true };
      }
    }

    if (Platform.OS === "android") {
      try {
        const { PermissionsAndroid } = require("react-native");
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: "Microphone Permission",
            message: "Proset needs access to your microphone to record audio.",
            buttonNeutral: "Ask Me Later",
            buttonNegative: "Cancel",
            buttonPositive: "OK",
          }
        );
        return { granted: granted === PermissionsAndroid.RESULTS.GRANTED };
      } catch (err) {
        console.warn("Android mic permission request failed:", err);
        return { granted: false };
      }
    }

    // iOS mic permissions are requested automatically by the audio session/recorder
    return { granted: true };
  }

  export async function setAudioModeAsync(options: any) {
    // No-op on web; Nitro Sound owns the native audio session.
    return Promise.resolve();
  }

  export class Recording {
    private mediaRecorder: any | null = null;
    private chunks: Blob[] = [];
    private uri: string | null = null;
    private startTime: number = 0;
    private isRecording: boolean = false;
    private analyser: AnalyserNode | null = null;
    private audioContext: AudioContext | null = null;
    private stream: MediaStream | null = null;
    private nativeSound: any = null;
    private lastMetering: number = -60;

    static async createAsync(options: any, deviceId?: string | null) {
      const recording = new Recording();
      await recording.startAsync(deviceId);
      return { recording };
    }

    async startAsync(deviceId?: string | null) {
      if (Platform.OS === "web") {
        try {
          const audioConstraints: any = { audio: true };
          if (deviceId && deviceId !== "default") {
            audioConstraints.audio = { deviceId: { exact: deviceId } };
          }
          let stream: MediaStream;
          try {
            stream = await navigator.mediaDevices.getUserMedia(audioConstraints);
          } catch {
            // Selected device not available — fall back to system default
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          }
          this.stream = stream;
          const options = { mimeType: "audio/webm" };
          this.mediaRecorder = new MediaRecorder(stream, options);
          this.chunks = [];

          this.mediaRecorder.ondataavailable = (e: any) => {
            if (e.data && e.data.size > 0) {
              this.chunks.push(e.data);
            }
          };

          this.mediaRecorder.onstop = () => {
            const blob = new Blob(this.chunks, { type: "audio/webm" });
            this.uri = URL.createObjectURL(blob);
          };

          // Unified audio pipeline: source → [analyser (metering), destination (recording)]
          const Ctor = window.AudioContext || (window as any).webkitAudioContext;
          if (Ctor) {
            this.audioContext = new Ctor();
            const source = this.audioContext.createMediaStreamSource(stream);

            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.7;
            source.connect(this.analyser);

            const dest = this.audioContext.createMediaStreamDestination();
            source.connect(dest);

            this.mediaRecorder = new MediaRecorder(dest.stream, options);
            this.chunks = [];
            this.mediaRecorder.ondataavailable = (e: any) => {
              if (e.data && e.data.size > 0) this.chunks.push(e.data);
            };
            this.mediaRecorder.onstop = () => {
              const blob = new Blob(this.chunks, { type: "audio/webm" });
              this.uri = URL.createObjectURL(blob);
            };
          }

          this.mediaRecorder.start(100);
          this.startTime = Date.now();
          this.isRecording = true;
        } catch (err) {
          console.error("Web Recording failed to start:", err);
          throw err;
        }
      } else {
        try {
          if (!this.nativeSound) {
            const { createSound } = require("react-native-nitro-sound");
            this.nativeSound = createSound();
          }
          const { Dirs } = require("react-native-file-access");
          const {
            AudioEncoderAndroidType,
            AudioSourceAndroidType,
            OutputFormatAndroidType,
          } = require("react-native-nitro-sound");
          const path = `${Dirs.CacheDir}/recording-${Date.now()}.m4a`;
          // AAC in an MPEG-4 container is natively supported by Android's
          // MediaRecorder and by every cloud transcription provider in Proset's
          // latency-first pipeline. The previous library mislabeled an
          // AMR/default MediaRecorder stream as PCM WAV.
          this.uri = await this.nativeSound.startRecorder(path, {
            AudioSamplingRate: 16000,
            AudioChannels: 1,
            AudioEncodingBitRate: 64000,
            AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
            OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
            AudioSourceAndroid: AudioSourceAndroidType.VOICE_COMMUNICATION,
          }, true); // meteringEnabled
          this.isRecording = true;
          this.nativeSound.addRecordBackListener((e: any) => {
            // currentMetering range: ~-60 (silence) to 0 (loud). Default to silence if missing.
            this.lastMetering = typeof e.currentMetering === "number" ? e.currentMetering : -60;
          });
        } catch (err) {
          console.error("Native Recording failed to start:", err);
          throw err;
        }
      }
    }

    async getStatusAsync(): Promise<RecordingStatus> {
      if (Platform.OS === "web" && this.analyser) {
        const dataArray = new Uint8Array(this.analyser.fftSize);
        this.analyser.getByteTimeDomainData(dataArray);
        let squareSum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const sample = (dataArray[i] - 128) / 128;
          squareSum += sample * sample;
        }
        const rms = Math.sqrt(squareSum / dataArray.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -60;
        return {
          isRecording: this.isRecording,
          metering: db,
        };
      }
      return {
        isRecording: this.isRecording,
        metering: this.lastMetering,
      };
    }

    async pauseAsync() {
      if (Platform.OS === "web") {
        if (this.mediaRecorder && this.isRecording) {
          this.mediaRecorder.pause();
          this.isRecording = false;
        }
      } else {
        if (this.nativeSound && this.isRecording) {
          await this.nativeSound.pauseRecorder();
          this.isRecording = false;
        }
      }
    }

    async resumeAsync() {
      if (Platform.OS === "web") {
        if (this.mediaRecorder && this.mediaRecorder.state === "paused") {
          this.mediaRecorder.resume();
          this.isRecording = true;
        }
      } else if (this.nativeSound && !this.isRecording) {
        await this.nativeSound.resumeRecorder();
        this.isRecording = true;
      }
    }

    async stopAndUnloadAsync() {
      this.isRecording = false;
      if (Platform.OS === "web") {
        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
          this.mediaRecorder.stop();
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (this.stream) {
          this.stream.getTracks().forEach((track) => track.stop());
        }
        if (this.audioContext) {
          await this.audioContext.close().catch(() => {});
        }
      } else {
        if (this.nativeSound) {
          await this.nativeSound.stopRecorder();
          this.nativeSound.removeRecordBackListener();
        }
      }
    }

    getURI() {
      if (Platform.OS !== "web" && this.uri && !this.uri.startsWith("file://")) {
        return `file://${this.uri}`;
      }
      return this.uri;
    }
  }

  export class Sound {
    private audio: HTMLAudioElement | null = null;
    private onStatusUpdate: ((status: SoundStatus) => void) | null = null;
    private isPlayingState: boolean = false;
    private intervalId: any = null;
    private nativeSound: any = null;
    private uri: string = "";
    private duration: number = 0;
    private position: number = 0;
    private nativePlayerStarted: boolean = false;
    private localObjectURL: string | null = null;

    static async createAsync(
      source: { uri: string },
      initialStatus: { shouldPlay?: boolean } = {},
      onStatusUpdate?: (status: SoundStatus) => void
    ) {
      const sound = new Sound();
      sound.onStatusUpdate = onStatusUpdate || null;
      sound.uri = source.uri;

      if (Platform.OS === "web") {
        let playUri = source.uri;
        if (source.uri && !source.uri.startsWith("blob:") && !source.uri.startsWith("data:")) {
          try {
            const { authFetch } = require("./query-client");
            const res = await authFetch(source.uri);
            if (res.ok) {
              const blob = await res.blob();
              playUri = URL.createObjectURL(blob);
              sound.localObjectURL = playUri;
            } else {
              console.error("Failed to fetch audio for playback, status:", res.status);
            }
          } catch (err) {
            console.error("Error fetching audio for playback:", err);
          }
        }

        sound.audio = new globalThis.Audio(playUri);
        sound.audio.preload = "auto";

        // Monitor load/error before attempting play
        sound.audio.onerror = () => {
          console.warn("Audio playback: failed to load", source.uri);
          sound.isPlayingState = false;
          if (sound.onStatusUpdate) {
            sound.onStatusUpdate({
              isLoaded: false,
              positionMillis: 0,
              durationMillis: 0,
              isPlaying: false,
              didJustFinish: false,
            } as SoundStatus);
          }
        };

        if (initialStatus.shouldPlay) {
          try {
            await sound.audio.play();
            sound.isPlayingState = true;
          } catch (playErr) {
            console.warn("Audio play() rejected:", playErr);
            // Browser may block autoplay — retry after user gesture
            sound.isPlayingState = false;
          }
        }
        sound.startStatusUpdates();
      } else {
        const { createSound } = require("react-native-nitro-sound");
        sound.nativeSound = createSound();
        sound.nativeSound.addPlaybackEndListener((e: any) => {
          sound.position = e.currentPosition;
          sound.duration = e.duration;
          sound.isPlayingState = false;
          sound.nativePlayerStarted = false;
          sound.nativeSound.removePlayBackListener();
          if (sound.onStatusUpdate) {
            sound.onStatusUpdate({
              isLoaded: true,
              positionMillis: e.currentPosition,
              durationMillis: e.duration,
              isPlaying: false,
              didJustFinish: true,
            });
          }
        });
        if (initialStatus.shouldPlay) {
          await sound.playAsync();
        }
      }

      return { sound };
    }

    private startStatusUpdates() {
      if (!this.audio) return;
      this.intervalId = setInterval(() => {
        this.updateStatus();
      }, 100);

      this.audio.onended = () => {
        this.isPlayingState = false;
        if (this.onStatusUpdate && this.audio) {
          this.onStatusUpdate({
            isLoaded: true,
            positionMillis: this.audio.duration * 1000,
            durationMillis: this.audio.duration * 1000,
            isPlaying: false,
            didJustFinish: true,
          });
        }
      };
    }

    private updateStatus() {
      if (this.audio && this.onStatusUpdate) {
        this.onStatusUpdate({
          isLoaded: true,
          positionMillis: this.audio.currentTime * 1000,
          durationMillis: (this.audio.duration || 0) * 1000,
          isPlaying: !this.audio.paused,
        });
      }
    }

    async getStatusAsync(): Promise<SoundStatus> {
      if (Platform.OS === "web" && this.audio) {
        return {
          isLoaded: true,
          positionMillis: this.audio.currentTime * 1000,
          durationMillis: (this.audio.duration || 0) * 1000,
          isPlaying: !this.audio.paused,
        };
      } else if (Platform.OS !== "web") {
        return {
          isLoaded: true,
          positionMillis: this.position,
          durationMillis: this.duration,
          isPlaying: this.isPlayingState,
        };
      }
      return {
        isLoaded: false,
        positionMillis: 0,
        durationMillis: 0,
        isPlaying: false,
      };
    }

    async pauseAsync() {
      if (Platform.OS === "web" && this.audio) {
        this.audio.pause();
        this.isPlayingState = false;
        this.updateStatus();
      } else if (Platform.OS !== "web") {
        if (this.nativeSound && this.isPlayingState) {
          await this.nativeSound.pausePlayer();
          this.isPlayingState = false;
          if (this.onStatusUpdate) {
            this.onStatusUpdate(await this.getStatusAsync());
          }
        }
      }
    }

    async playAsync() {
      if (Platform.OS === "web" && this.audio) {
        try {
          await this.audio.play();
          this.isPlayingState = true;
          this.updateStatus();
        } catch (err) {
          console.warn("Audio playAsync() rejected:", err);
          this.isPlayingState = false;
        }
      } else if (Platform.OS !== "web") {
        if (this.nativeSound) {
          this.isPlayingState = true;
          if (this.nativePlayerStarted) {
            await this.nativeSound.resumePlayer();
          } else {
            const cleanPath = this.uri.replace(/^file:\/\//, "");
            await this.nativeSound.startPlayer(cleanPath);
            this.nativePlayerStarted = true;
            this.nativeSound.addPlayBackListener((e: any) => {
              this.position = e.currentPosition;
              this.duration = e.duration;
              if (this.onStatusUpdate) {
                this.onStatusUpdate({
                  isLoaded: true,
                  positionMillis: e.currentPosition,
                  durationMillis: e.duration,
                  isPlaying: true,
                });
              }
            });
          }
        }
      }
    }

    async unloadAsync() {
      if (Platform.OS === "web") {
        if (this.intervalId) {
          clearInterval(this.intervalId);
        }
        if (this.audio) {
          this.audio.pause();
          this.audio = null;
        }
        if (this.localObjectURL) {
          URL.revokeObjectURL(this.localObjectURL);
          this.localObjectURL = null;
        }
      } else if ((Platform.OS as string) !== "web") {
        if (this.nativeSound) {
          await this.nativeSound.stopPlayer();
          this.nativeSound.removePlayBackListener();
          this.nativeSound.removePlaybackEndListener();
          this.nativeSound = null;
        }
        this.nativePlayerStarted = false;
        this.isPlayingState = false;
      }
    }
  }

  export const RecordingOptionsPresets = {
    HIGH_QUALITY: {},
  };
}
