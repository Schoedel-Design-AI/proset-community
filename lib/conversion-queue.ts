import AsyncStorage from "@react-native-async-storage/async-storage";

export interface PendingConversionJob {
  id: string;
  recordingId: string;
  type: string;
  citationStyle?: string;
  bibliographyType?: string;
  customPrompt?: string;
  createdAt: string;
}

const CONVERSION_QUEUE_KEY = "proset_offline_conversion_queue_v1";

export async function enqueueConversionJob(
  job: Omit<PendingConversionJob, "id" | "createdAt">,
): Promise<PendingConversionJob> {
  const newJob: PendingConversionJob = {
    ...job,
    id: `conv_job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    createdAt: new Date().toISOString(),
  };

  try {
    const existingRaw = await AsyncStorage.getItem(CONVERSION_QUEUE_KEY);
    const existing: PendingConversionJob[] = existingRaw ? JSON.parse(existingRaw) : [];
    existing.push(newJob);
    await AsyncStorage.setItem(CONVERSION_QUEUE_KEY, JSON.stringify(existing));
  } catch (err) {
    console.error("[conversion-queue] Failed to enqueue conversion job:", err);
  }

  return newJob;
}

export async function getPendingConversionJobs(): Promise<PendingConversionJob[]> {
  try {
    const existingRaw = await AsyncStorage.getItem(CONVERSION_QUEUE_KEY);
    return existingRaw ? JSON.parse(existingRaw) : [];
  } catch {
    return [];
  }
}

export async function removeConversionJob(jobId: string): Promise<void> {
  try {
    const existingRaw = await AsyncStorage.getItem(CONVERSION_QUEUE_KEY);
    if (!existingRaw) return;
    const existing: PendingConversionJob[] = JSON.parse(existingRaw);
    const filtered = existing.filter((j) => j.id !== jobId);
    await AsyncStorage.setItem(CONVERSION_QUEUE_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.error("[conversion-queue] Failed to remove job:", err);
  }
}

export async function clearConversionQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CONVERSION_QUEUE_KEY);
  } catch {}
}
