import ffmpegPath from "ffmpeg-static";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export const SUPPORTED_AUDIO_FORMATS = ["mp3", "wav", "m4a", "flac", "ogg"] as const;
export type SupportedAudioFormat = (typeof SUPPORTED_AUDIO_FORMATS)[number];

export function isSupportedAudioFormat(format: string): format is SupportedAudioFormat {
  const normalized = format.toLowerCase().replace(/^\./, "");
  return (SUPPORTED_AUDIO_FORMATS as readonly string[]).includes(normalized);
}

export const AUDIO_FORMAT_CONFIG: Record<
  SupportedAudioFormat,
  {
    mimeType: string;
    ext: string;
    ffmpegArgs: string[];
  }
> = {
  mp3: {
    mimeType: "audio/mpeg",
    ext: "mp3",
    ffmpegArgs: ["-c:a", "libmp3lame", "-b:a", "192k"],
  },
  wav: {
    mimeType: "audio/wav",
    ext: "wav",
    ffmpegArgs: ["-c:a", "pcm_s16le"],
  },
  m4a: {
    mimeType: "audio/mp4",
    ext: "m4a",
    ffmpegArgs: ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
  },
  flac: {
    mimeType: "audio/flac",
    ext: "flac",
    ffmpegArgs: ["-c:a", "flac"],
  },
  ogg: {
    mimeType: "audio/ogg",
    ext: "ogg",
    ffmpegArgs: ["-c:a", "libvorbis", "-q:a", "4"],
  },
};

const FFMPEG_CONVERT_TIMEOUT_MS = 120_000; // 2 minutes

export async function convertAudioBuffer(
  inputBuffer: Buffer,
  targetFormat: SupportedAudioFormat,
): Promise<Buffer> {
  const ffmpegBinary = ffmpegPath;
  if (!ffmpegBinary) {
    throw new Error("FFmpeg binary not found on server.");
  }

  const config = AUDIO_FORMAT_CONFIG[targetFormat];
  if (!config) {
    throw new Error(`Unsupported audio format: ${targetFormat}`);
  }

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "proset-audio-convert-"));
  const inputPath = path.join(tmpDir, "input.audio");
  const outputPath = path.join(tmpDir, `output.${config.ext}`);

  try {
    await fs.promises.writeFile(inputPath, inputBuffer);

    await new Promise<void>((resolve, reject) => {
      const args = [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", inputPath,
        ...config.ffmpegArgs,
        outputPath,
      ];

      const child = spawn(ffmpegBinary, args, { stdio: ["ignore", "pipe", "pipe"] });

      const stderrChunks: Buffer[] = [];
      child.stderr.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Audio conversion timed out after 120 seconds."));
      }, FFMPEG_CONVERT_TIMEOUT_MS);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          const stderrStr = Buffer.concat(stderrChunks).toString("utf8");
          reject(new Error(`FFmpeg exited with code ${code}: ${stderrStr || "conversion failed"}`));
          return;
        }
        resolve();
      });
    });

    return await fs.promises.readFile(outputPath);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
