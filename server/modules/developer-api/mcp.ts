import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { extractBearerToken, resolveApiKey } from "./api-keys";
import { runCoreConversion } from "./conversion";
import { storage } from "../../storage";
import { transcribeAudioLatencyFirst } from "../../transcription-routing";
import { paragraphizeTranscript } from "@shared/transcript-format";
import {
  checkLimit,
  incrementUsage,
  reportExtendedAccessIfNeeded,
  getUserUsageSummary,
} from "../../usage-service";

const MCP_SERVER_NAME = "proset";
const MCP_SERVER_VERSION = "1.0.0";

// Per-session bookkeeping: session ID -> transport + owning user + last activity.
// Bounded to prevent unbounded memory growth on a long-lived instance (Cloud Run
// with min-instances=1): a hard cap rejects new sessions with 429, an idle TTL
// evicts abandoned sessions, and a periodic sweep enforces the TTL even when a
// client never sends a proper close.
const MAX_MCP_SESSIONS = 1000;
const MCP_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes of inactivity.

interface McpSession {
  transport: StreamableHTTPServerTransport;
  userId: string;
  lastActivity: number;
}

const sessions = new Map<string, McpSession>();

function touch(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) session.lastActivity = Date.now();
}

function sweepStaleSessions(): void {
  const cutoff = Date.now() - MCP_SESSION_TTL_MS;
  for (const [sessionId, session] of sessions) {
    if (session.lastActivity < cutoff) sessions.delete(sessionId);
  }
}

// Unref'd so the sweep timer never keeps a process alive on its own.
setInterval(sweepStaleSessions, 5 * 60 * 1000).unref();

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function requireUserId(sessionId: string | undefined): string {
  if (!sessionId) {
    throw new Error("MCP session not established. Reconnect your MCP client.");
  }
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("MCP session is not authenticated.");
  }
  return session.userId;
}

function createMcpServer(): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });

  server.tool(
    "list_recordings",
    "List the authenticated user's recordings (most recently created first) with their titles, durations, and whether they have a transcript.",
    { limit: z.number().int().min(1).max(100).optional() },
    async (args, extra) => {
      const userId = requireUserId(extra.sessionId);
      // Use the paginated query when a limit is provided to avoid loading the
      // entire recording list into memory before slicing.
      const recordings = args.limit
        ? (await storage.getRecordingsByUserPaginated(userId, { limit: args.limit })).recordings
        : (await storage.getRecordingsByUser(userId)).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
      return textResult(JSON.stringify(
        recordings.map((r) => ({
          id: r.id,
          title: r.title,
          duration: r.duration,
          hasTranscript: Boolean(r.transcript),
          createdAt: r.createdAt,
        })),
        null,
        2,
      ));
    },
  );

  server.tool(
    "get_recording",
    "Fetch a single recording by ID, including its full transcript and any conversion artifacts.",
    { recording_id: z.string().describe("The recording ID.") },
    async (args, extra) => {
      const userId = requireUserId(extra.sessionId);
      const recording = await storage.getRecording(args.recording_id, userId);
      if (!recording) {
        return textResult(JSON.stringify({ error: "Recording not found." }));
      }
      return textResult(JSON.stringify(recording, null, 2));
    },
  );

  server.tool(
    "list_thought_threads",
    "List the authenticated user's Thought Threads (grouped recordings for multi-source conversion).",
    {},
    async (_args, extra) => {
      const userId = requireUserId(extra.sessionId);
      const threads = await storage.thoughtThreads.getByUser(userId);
      return textResult(JSON.stringify(threads, null, 2));
    },
  );

  server.tool(
    "get_thought_thread",
    "Fetch a Thought Thread by ID, including its items and context sources.",
    { thread_id: z.string().describe("The Thought Thread ID.") },
    async (args, extra) => {
      const userId = requireUserId(extra.sessionId);
      const thread = await storage.thoughtThreads.get(args.thread_id, userId);
      if (!thread) {
        return textResult(JSON.stringify({ error: "Thought Thread not found." }));
      }
      const [items, contexts] = await Promise.all([
        storage.thoughtThreadItems.getByThread(thread.id, userId),
        storage.thoughtThreadContexts.getByThread(thread.id, userId),
      ]);
      return textResult(JSON.stringify({ thread, items, contexts }, null, 2));
    },
  );

  server.tool(
    "list_folders",
    "List the authenticated user's folders.",
    {},
    async (_args, extra) => {
      const userId = requireUserId(extra.sessionId);
      const folders = await storage.userFolders.getByUser(userId);
      return textResult(JSON.stringify(folders, null, 2));
    },
  );

  server.tool(
    "get_usage",
    "Return the authenticated user's current plan tier and usage limits.",
    {},
    async (_args, extra) => {
      const userId = requireUserId(extra.sessionId);
      const usage = await getUserUsageSummary(userId);
      return textResult(JSON.stringify(usage, null, 2));
    },
  );

  server.tool(
    "transcribe",
    "Transcribe audio (base64-encoded) into text. Use the REST /api/v1/transcribe endpoint for large files.",
    {
      audio_base64: z.string().describe("Base64-encoded audio file contents."),
      filename: z.string().optional().describe("Original filename, used to infer the audio format."),
      language: z.string().optional().describe("Optional source language hint."),
      prompt: z.string().optional().describe("Optional transcription prompt."),
      confirmExtendedAccess: z.boolean().optional().describe("Consent to pay-as-you-go overage (required once included transcriptions are exhausted)."),
    },
    async (args, extra) => {
      const userId = requireUserId(extra.sessionId);
      const limitCheck = await checkLimit(userId, "transcription");
      if (!limitCheck.allowed) {
        return textResult(JSON.stringify({
          error: limitCheck.spendingCapReached ? "spending_cap_reached" : "monthly_limit_reached",
          message: limitCheck.spendingCapReached
            ? "You've reached your monthly spending cap for Pro plan overages."
            : `You've used all ${limitCheck.limit} included transcriptions this month.`,
        }));
      }
      if (limitCheck.isExtendedAccess && !limitCheck.proAccessEnabled && !args.confirmExtendedAccess) {
        return textResult(JSON.stringify({
          error: "pro_access_required",
          message: "Overage consent required. Retry with confirmExtendedAccess: true to continue with pay-as-you-go overage.",
        }));
      }
      const fileBuffer = Buffer.from(args.audio_base64, "base64");
      const result = await transcribeAudioLatencyFirst({
        fileBuffer,
        fileName: args.filename || "audio.webm",
        language: args.language,
        prompt: args.prompt,
      });
      await incrementUsage(userId, "transcription");
      reportExtendedAccessIfNeeded(userId, "transcription");
      return textResult(paragraphizeTranscript(result.text));
    },
  );

  server.tool(
    "convert",
    "Convert a transcript into an artifact (e.g. summary, email, academic research, spreadsheet, calendar). Returns the complete converted text.",
    {
      transcript: z.string().describe("The transcript text to convert."),
      type: z.string().describe("The conversion type (e.g. 'summary', 'email', 'academic_research', 'spreadsheet')."),
      customPrompt: z.string().optional().describe("Optional custom prompt that overrides the type's default."),
      citationStyle: z.string().optional().describe("Citation style for research/bibliography types (e.g. 'apa7')."),
      bibliographyType: z.string().optional().describe("Bibliography mode (e.g. 'annotated')."),
      outputFormat: z.enum(["markdown", "plain"]).optional(),
      language: z.enum(["en", "es"]).optional(),
      confirmExtendedAccess: z.boolean().optional().describe("Consent to pay-as-you-go overage (required once included conversions are exhausted)."),
    },
    async (args, extra) => {
      const userId = requireUserId(extra.sessionId);
      try {
        const result = await runCoreConversion(userId, {
          transcript: args.transcript,
          type: args.type,
          customPrompt: args.customPrompt,
          citationStyle: args.citationStyle,
          bibliographyType: args.bibliographyType,
          outputFormat: args.outputFormat,
          language: args.language,
          confirmExtendedAccess: args.confirmExtendedAccess,
        });
        return textResult(result.content);
      } catch (error: any) {
        return textResult(JSON.stringify({
          error: error?.code || "conversion_failed",
          message: error?.message || "Conversion failed.",
        }));
      }
    },
  );

  return server;
}

const mcpServer = createMcpServer();

export const mcpRouter = express.Router();

// The global body parser (1 MB) is sufficient for MCP control messages and
// modest base64 audio. Larger audio should use POST /api/v1/transcribe.
mcpRouter.post("/", async (req: Request, res: Response) => {
  const token = extractBearerToken(req);
  const resolution = token ? await resolveApiKey(token) : null;
  if (!resolution || resolution.status !== "ok") {
    return res.status(401).json({
      error: resolution?.status === "expired" ? "expired_api_key" : "invalid_api_key",
      message:
        resolution?.status === "expired"
          ? "This API key has expired."
          : "A valid API key is required.",
    });
  }
  const user = resolution.user;

  const sessionId = (req.headers["mcp-session-id"] as string | undefined) || undefined;

  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (!existing) {
      return res.status(404).json({ error: "Session not found. Re-initialize the MCP connection." });
    }
    if (existing.userId !== user.id) {
      return res.status(403).json({ error: "API key does not match this session." });
    }
    touch(sessionId);
    return existing.transport.handleRequest(req, res, req.body);
  }

  // New session — create a stateful transport keyed to the authenticated user.
  if (sessions.size >= MAX_MCP_SESSIONS) {
    return res.status(429).json({
      error: "mcp_sessions_full",
      message: "The MCP server is at capacity. Please try again later.",
    });
  }
  let sid: string | undefined;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (newSessionId) => {
      sid = newSessionId;
      sessions.set(newSessionId, { transport, userId: user.id, lastActivity: Date.now() });
    },
  });
  transport.onclose = () => {
    if (sid) sessions.delete(sid);
  };

  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

mcpRouter.get("/", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session) {
    return res.status(400).json({ error: "Missing or invalid MCP session." });
  }
  // The session ID alone must not grant access — re-verify the API key.
  const token = extractBearerToken(req);
  const resolution = token ? await resolveApiKey(token) : null;
  if (!resolution || resolution.status !== "ok" || session.userId !== resolution.user.id) {
    return res.status(401).json({ error: "invalid_api_key", message: "API key does not match this MCP session." });
  }
  touch(sessionId!);
  await session.transport.handleRequest(req, res);
});

mcpRouter.delete("/", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session) {
    return res.status(400).json({ error: "Missing or invalid MCP session." });
  }
  const token = extractBearerToken(req);
  const resolution = token ? await resolveApiKey(token) : null;
  if (!resolution || resolution.status !== "ok" || session.userId !== resolution.user.id) {
    return res.status(401).json({ error: "invalid_api_key", message: "API key does not match this MCP session." });
  }
  touch(sessionId!);
  await session.transport.handleRequest(req, res);
});
