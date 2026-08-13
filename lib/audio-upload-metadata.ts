export interface AudioUploadMetadata {
  name: string;
  type: string;
}

/**
 * Preserve the real format when retrying recordings created by older app
 * versions. New native recordings are AAC/M4A, but existing cached WAV files
 * must not be relabeled as MPEG-4 during a retry.
 */
export function getAudioUploadMetadata(uri: string): AudioUploadMetadata {
  const path = uri.split(/[?#]/, 1)[0].toLowerCase();

  if (path.endsWith(".wav")) return { name: "recording.wav", type: "audio/wav" };
  if (path.endsWith(".webm")) return { name: "recording.webm", type: "audio/webm" };
  if (path.endsWith(".mp3")) return { name: "recording.mp3", type: "audio/mpeg" };
  if (path.endsWith(".ogg") || path.endsWith(".oga")) {
    return { name: "recording.ogg", type: "audio/ogg" };
  }
  if (path.endsWith(".aac")) return { name: "recording.aac", type: "audio/aac" };

  return { name: "recording.m4a", type: "audio/mp4" };
}
