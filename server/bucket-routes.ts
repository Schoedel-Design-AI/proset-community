import type { Express, Request, Response } from "express";
import multer from "multer";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { getStorageLimit } from "./usage-service";
import {
  bucketFilesTableExists,
  uploadFile,
  downloadFileAsStream,
  detectMimeType,
  categoryFromMime,
  generateBucketKey,
  generateDevBucketKey,
  createBucketFileRecord,
  getBucketFileById,
  getBucketFileByKey,
  getUserBucketFiles,
  deleteBucketFileRecord,
  type BucketCategory,
} from "./object-storage";

const bucketUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

function getSingleParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] || "";
  return "";
}

async function getBucketStorageUsed(userId: string): Promise<number> {
  const files = await storage.bucketFiles.getByUser(userId);
  return files.reduce((acc, f) => acc + (f.fileSize || 0), 0);
}

export { getBucketStorageUsed };

export function registerBucketRoutes(app: Express) {
  app.get("/api/bucket/resolve/*key", requireAuth, async (req: Request, res: Response) => {
    try {
      const bucketKey = getSingleParam(req.params.key);
      if (!bucketKey) return res.status(400).json({ error: "Missing bucket key." });

      const record = await getBucketFileByKey(bucketKey);
      if (!record) return res.status(404).json({ error: "File not found." });

      const userId = req.userId!;
      if (record.userId !== userId) {
        return res.status(403).json({ error: "Access denied." });
      }

      res.setHeader("Content-Type", record.mimeType);
      if (record.fileSize) {
        res.setHeader("Content-Length", record.fileSize.toString());
      }
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(record.originalName)}"`);
      res.setHeader("Cache-Control", "private, max-age=3600");
      const stream = await downloadFileAsStream(record.bucketKey);
      stream.on("error", (err) => {
        console.error("Bucket stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to stream file." });
        }
      });
      stream.pipe(res);
    } catch (error: unknown) {
      console.error("Bucket resolve error:", error);
      res.status(500).json({ error: "We had trouble loading that file. Please try again." });
    }
  });

  app.post("/api/bucket/upload", requireAuth, bucketUpload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Please select a file to upload." });
      }
      const userId = req.userId!;
      if (!(await bucketFilesTableExists())) {
        return res.status(503).json({ error: "Bucket storage metadata is not available yet. Please try again after the schema bootstrap finishes." });
      }
      const mimeType = req.file.mimetype || detectMimeType(req.file.originalname);
      const validCategories: BucketCategory[] = ["audio", "image", "video", "file"];
      const requestedCategory = req.body.category;
      const category: BucketCategory = (requestedCategory && validCategories.includes(requestedCategory))
        ? requestedCategory
        : categoryFromMime(mimeType);
      const fileSize = req.file.size;

      const storageLimit = await getStorageLimit(userId);
      const bucketUsed = await getBucketStorageUsed(userId);
      const textFiles = await storage.userFiles.getByUser(userId);
      const textUsed = textFiles.reduce((acc, f) => acc + (f.fileSize || 0), 0);
      const totalUsed = bucketUsed + textUsed;
      if (storageLimit === 0 || totalUsed + fileSize > storageLimit) {
        return res.status(413).json({ error: "Storage limit exceeded", used: totalUsed, limit: storageLimit });
      }

      const bucketKey = generateBucketKey(userId, category, req.file.originalname);
      await uploadFile(bucketKey, req.file.buffer);

      const record = await createBucketFileRecord({
        userId,
        bucketKey,
        originalName: req.file.originalname,
        mimeType,
        fileSize,
        category,
      });

      res.json(record);
    } catch (error: unknown) {
      console.error("Bucket upload error:", error);
      res.status(500).json({ error: "We had trouble uploading your file. Please try again." });
    }
  });

  app.get("/api/bucket/files", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const { category } = req.query;
      const validCategories: BucketCategory[] = ["audio", "image", "video", "file"];
      const cat = (category && typeof category === "string" && validCategories.includes(category as BucketCategory))
        ? category as BucketCategory
        : undefined;
      const files = await getUserBucketFiles(userId, cat);
      res.json(files);
    } catch (error: unknown) {
      res.status(500).json({ error: "We had trouble loading your files. Please try again." });
    }
  });

  app.get("/api/bucket/files/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const fileId = getSingleParam(req.params.id);
      const record = await getBucketFileById(fileId);
      if (!record || record.userId !== userId) return res.status(404).json({ error: "File not found." });

      res.setHeader("Content-Type", record.mimeType);
      if (record.fileSize) {
        res.setHeader("Content-Length", record.fileSize.toString());
      }
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(record.originalName)}"`);
      res.setHeader("Cache-Control", "private, max-age=3600");
      const stream = await downloadFileAsStream(record.bucketKey);
      stream.on("error", (err) => {
        console.error("Bucket stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to stream file." });
        }
      });
      stream.pipe(res);
    } catch (error: unknown) {
      console.error("Bucket download error:", error);
      res.status(500).json({ error: "We had trouble downloading that file. Please try again." });
    }
  });

  app.delete("/api/bucket/files/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const fileId = getSingleParam(req.params.id);
      const deleted = await deleteBucketFileRecord(fileId, userId);
      if (!deleted) return res.status(404).json({ error: "File not found." });
      res.json({ ok: true });
    } catch (error: unknown) {
      console.error("Bucket delete error:", error);
      res.status(500).json({ error: "We had trouble deleting that file. Please try again." });
    }
  });

  app.get("/api/bucket/storage", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const used = await getBucketStorageUsed(userId);
      const storageLimit = await getStorageLimit(userId);
      const userFilesList = await storage.bucketFiles.getByUser(userId);
      res.json({
        bucketUsed: used,
        bucketLimit: storageLimit,
        bucketFileCount: userFilesList.length,
        bucketPercentage: storageLimit > 0 ? Math.round((used / storageLimit) * 100) : 0,
      });
    } catch (error: unknown) {
      res.status(500).json({ error: "We had trouble loading storage info. Please try again." });
    }
  });
}
