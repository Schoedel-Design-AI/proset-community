import { storage } from "../../storage";
import { getStorageLimit } from "../../usage-service";

export const SYSTEM_FOLDERS = [
  "Summary", "Email", "Blog Post", "Bullet Points", "To-Do List",
  "Calendar Event", "LinkedIn Post", "AI Prompt", "Questions",
  "Plan", "Requirements", "Quick Research", "Spreadsheet",
  "Linux Commands", "Python Script", "Academic Research (Asst.)",
  "Notes", "Outline", "Action Items", "Combined"
];

export const COMBINED_FOLDER_NAME = "Combined";

export const RENAMED_SYSTEM_FOLDERS: Record<string, string> = {
  "Academic Research": "Academic Research (Asst.)",
};

export async function ensureSystemFolders(userId: string) {
  const folders = await storage.userFolders.getByUser(userId);
  const existing = folders.filter(f => f.isSystem === 1);
  const existingNames = new Set(existing.map(f => f.name));
  
  for (const oldName of Object.keys(RENAMED_SYSTEM_FOLDERS)) {
    const newName = RENAMED_SYSTEM_FOLDERS[oldName];
    const existingOld = folders.find(f => f.name === oldName);
    if (existingOld) {
      await storage.userFolders.update(existingOld.id, { name: newName, isSystem: 1 });
      existingNames.add(newName);
    }
  }

  for (const folder of SYSTEM_FOLDERS) {
    if (!existingNames.has(folder)) {
      await storage.userFolders.create({
        id: "",
        userId,
        name: folder,
        isSystem: 1,
        parentId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }
}

export async function getUserStorageUsed(userId: string): Promise<number> {
  const files = await storage.userFiles.getByUser(userId);
  return files.reduce((acc, f) => acc + (f.fileSize || 0), 0);
}

export async function getTotalUserStorageUsed(userId: string): Promise<number> {
  const [generatedBytes, retainedFiles] = await Promise.all([
    getUserStorageUsed(userId),
    storage.bucketFiles.getByUser(userId),
  ]);
  return generatedBytes
    + retainedFiles.reduce((total, file) => total + (file.fileSize || 0), 0);
}

export async function autoSaveFile(userId: string, opts: {
  name: string;
  content: string;
  conversionType?: string;
  sourceRecordingId?: string;
  mimeType?: string;
}) {
  try {
    const fileSize = Buffer.byteLength(opts.content, "utf-8");
    const used = await getTotalUserStorageUsed(userId);
    const storageLimit = await getStorageLimit(userId);
    if (storageLimit === 0 || used + fileSize > storageLimit) {
      console.warn("Auto-save skipped: storage limit exceeded for user", userId);
      return;
    }
    let targetFolderId: string | null = null;
    if (opts.conversionType) {
      await ensureSystemFolders(userId);
      const folders = await storage.userFolders.getByUser(userId);
      const systemFolder = folders.find(f => f.name === opts.conversionType && f.isSystem === 1);
      if (systemFolder) targetFolderId = systemFolder.id;
    }
    const allFiles = await storage.userFiles.getByUser(userId);
    const existing = allFiles.filter(f => 
      f.name === opts.name && 
      (!opts.sourceRecordingId || f.sourceRecordingId === opts.sourceRecordingId) &&
      (!opts.conversionType || f.conversionType === opts.conversionType)
    );
    if (existing.length > 0) {
      await storage.userFiles.update(existing[0].id, {
        content: opts.content,
        fileSize,
        updatedAt: new Date().toISOString(),
      });
    } else {
      await storage.userFiles.create({
        id: "",
        userId,
        name: opts.name,
        content: opts.content,
        conversionType: opts.conversionType || null,
        folderId: targetFolderId,
        sourceRecordingId: opts.sourceRecordingId || null,
        fileSize,
        mimeType: opts.mimeType || "text/plain",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  } catch (err) {
    console.error("Auto-save file failed:", err);
  }
}

export async function autoSaveRecordingFiles(userId: string, recording: any) {
  if (recording.transcript) {
    await autoSaveFile(userId, {
      name: `${recording.title} - Transcript`,
      content: recording.transcript,
      conversionType: "Notes",
      sourceRecordingId: recording.id,
    });
  }
  const conversions = Array.isArray(recording.conversions) ? recording.conversions : [];
  for (const conv of conversions) {
    if (conv.content && conv.label) {
      await autoSaveFile(userId, {
        name: `${recording.title} - ${conv.label}`,
        content: conv.content,
        conversionType: conv.label,
        sourceRecordingId: recording.id,
      });
    }
  }
}
