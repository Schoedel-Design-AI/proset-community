import "./polyfill";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import compression from "compression";
import { rateLimit } from "express-rate-limit";
import { Readable } from "stream";
import type { IncomingMessage } from "http";
import { registerRoutes } from "./routes";
import { setupAuthRoutes } from "./auth";
import { firebaseAuthMiddleware } from "./firebase-admin";
import { WebhookHandlers } from "./stripe-webhooks";
import { handleRevenueCatWebhook } from "./revenuecat-webhooks";
import { stripeService } from "./stripe-service";
import { getExpectedStripeMode, isStripeBillingEnabled } from "./stripe-client";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { getOpenAIApiKey, getOpenAIBaseUrl, hasDedicatedAIProviderConfig } from "./openai-client";
import { getTranscriptionRoutes, getTranscriptionTotalTimeoutMs } from "./transcription-routing";

import { getPublicDeploymentInfo } from "./deployment-info";
import { validateEmailAddress } from "@shared/email-validation";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const app = express();

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;
const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || (process.env.NODE_ENV === "production" ? "info" : "debug");

function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (LOG_LEVELS[level] > LOG_LEVELS[currentLevel]) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta || {}),
  };
  if (level === "error") console.error(JSON.stringify(entry));
  else if (level === "warn") console.warn(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}

const AUTH_BODY_LIMIT = 1024 * 1024;

function bufferRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const contentLength = parseInt(req.headers["content-length"] || "", 10);
    if (contentLength > AUTH_BODY_LIMIT) {
      req.destroy();
      return reject(new Error("Request body too large"));
    }
    let received = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > AUTH_BODY_LIMIT) {
        req.destroy();
        return reject(new Error("Request body too large"));
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function createRequestWithBody(original: IncomingMessage, body: Buffer): IncomingMessage {
  const stream = new Readable({
    read() {
      this.push(body);
      this.push(null);
    },
  }) as IncomingMessage;
  stream.headers = { ...original.headers, "content-length": String(body.length) };
  stream.method = original.method;
  stream.url = original.url;
  stream.httpVersion = original.httpVersion;
  stream.httpVersionMajor = original.httpVersionMajor;
  stream.httpVersionMinor = original.httpVersionMinor;
  stream.socket = original.socket;
  return stream;
}

function setupSecurityHeaders(app: express.Application) {
  const connectSrc: string[] = [
    "'self'",
    "blob:",
    "https://proset.ai",
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
  ];
  const scriptSrc: string[] = ["'self'", "'unsafe-inline'", "https://challenges.cloudflare.com"];
  const frameSrc: string[] = ["'self'", "https://challenges.cloudflare.com"];



  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc,
          frameSrc,
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "blob:"],
          mediaSrc: ["'self'", "blob:"],
          connectSrc,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  // Compress everything EXCEPT SSE streams. Gzip-compressing an event-stream
  // buffers the response and can break client-side streaming readers (RN
  // native in particular) — SSE must flow through untouched.
  app.use(
    compression({
      filter: (req, res) => {
        const type = res.getHeader("Content-Type");
        if (typeof type === "string" && type.includes("text/event-stream")) {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );
}

function setupMatrixWellKnown(app: express.Application) {
  const setWellKnownHeaders = (res: Response) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "public, max-age=3600");
    res.type("application/json");
  };

  app.options("/.well-known/matrix/client", (_req: Request, res: Response) => {
    setWellKnownHeaders(res);
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).end();
  });

  app.get("/.well-known/matrix/server", (_req: Request, res: Response) => {
    setWellKnownHeaders(res);
    res.json({ "m.server": "matrix.proset.ai:443" });
  });

  app.get("/.well-known/matrix/client", (_req: Request, res: Response) => {
    setWellKnownHeaders(res);
    res.json({
      "m.homeserver": {
        base_url: "https://matrix.proset.ai",
      },
    });
  });
}

function setupRateLimiting(app: express.Application) {
  const getForwardedIp = (req: express.Request): string => {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim().length > 0) {
      return forwarded.split(",")[0].trim();
    }
    return req.socket.remoteAddress || "unknown";
  };

  const getAuthLimiterKey = (req: express.Request): string => {
    const ip = getForwardedIp(req);
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";

    // Use IP+email when available so one account's retries do not throttle unrelated users
    // behind the same NAT/egress address.
    return email ? `${ip}:${email}` : ip;
  };

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "We've temporarily paused sign-in attempts for your safety. Try again in about 15 minutes — your account is fine." },
    keyGenerator: getAuthLimiterKey,
    skip: (req) => req.hostname === "localhost" || req.hostname === "127.0.0.1" || process.env.DISABLE_RATE_LIMIT === "true",
  });

  const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "You've hit our registration safety limit. Take a breather — your info is safe — and try again in about an hour." },
    keyGenerator: getForwardedIp,
    skip: (req) => req.hostname === "localhost" || req.hostname === "127.0.0.1" || process.env.DISABLE_RATE_LIMIT === "true",
  });

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 100,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down." },
    skip: (req) => req.hostname === "localhost" || req.hostname === "127.0.0.1" || process.env.DISABLE_RATE_LIMIT === "true",
  });

  const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many AI requests. Please wait a moment before trying again." },
    keyGenerator: (req) => {
      return req.userId || req.socket.remoteAddress || "unknown";
    },
    skip: (req) => req.hostname === "localhost" || req.hostname === "127.0.0.1" || process.env.DISABLE_RATE_LIMIT === "true",
  });

  const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "We've capped reset attempts to keep your account safe. Sit tight for about 15 minutes, then try again." },
    keyGenerator: getForwardedIp,
    skip: (req) => req.hostname === "localhost" || req.hostname === "127.0.0.1" || process.env.DISABLE_RATE_LIMIT === "true",
  });

  const verificationResendLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 2,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "We just sent one — give it about a minute to land in your inbox before requesting another." },
    keyGenerator: getForwardedIp,
    skip: (req) => req.hostname === "localhost" || req.hostname === "127.0.0.1" || process.env.DISABLE_RATE_LIMIT === "true",
  });

  app.use("/api/auth/sign-in", authLimiter);
  app.use("/api/auth/sign-up", registrationLimiter);
  app.use("/api/auth/request-password-reset", passwordResetLimiter);
  app.use("/api/auth/forget-password", passwordResetLimiter);
  app.use("/api/auth/reset-password", passwordResetLimiter);
  app.use("/api/auth/resend-verification", verificationResendLimiter);
  app.use("/api/transcribe", aiLimiter);
  app.use("/api/convert", aiLimiter);
  app.use("/api/", apiLimiter);
}

function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function setupCsrfProtection(_app: express.Application) {
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origins = new Set<string>();

    origins.add("https://proset.ai");

    // Add PUBLIC_APP_URL if set (production canonical origin)
    if (process.env.PUBLIC_APP_URL) {
      origins.add(process.env.PUBLIC_APP_URL.replace(/\/+$/, ""));
    }

    const origin = req.header("origin");

    const isLocalhost = !IS_PRODUCTION && (
      origin?.startsWith("http://localhost:") ||
      origin?.startsWith("http://127.0.0.1:")
    );

    const host = req.get("host");
    const isSameOrigin = origin && host && (origin === `https://${host}` || origin === `http://${host}`);

    if (origin && (origins.has(origin) || isLocalhost || isSameOrigin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Cookie, x-csrf-token, expo-platform, x-request-id",
      );
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Access-Control-Expose-Headers", "Set-Cookie, x-request-id");
      res.header("Access-Control-Max-Age", "600");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  const preserveRawBody = (req: express.Request, _res: express.Response, buf: Buffer) => {
    req.rawBody = buf;
  };
  // Only conversion requests need the larger immutable source envelope.
  // Express skips later body parsers after the route-scoped parser succeeds.
  app.use(
    "/api/convert",
    express.json({ limit: "10mb", verify: preserveRawBody }),
  );
  app.use(express.json({ limit: "1mb", verify: preserveRawBody }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
}

function setupRequestId(app: express.Application) {
  app.use((req, res, next) => {
    const requestId = req.headers["x-request-id"] as string || crypto.randomUUID();
    req.headers["x-request-id"] = requestId;
    res.setHeader("x-request-id", requestId);
    next();
  });
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const reqPath = req.path;
    let capturedAuthError: { error?: string; code?: string } | undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      // Never retain or log arbitrary API response bodies. Transcript,
      // document, conversion, and profile responses can all contain private
      // user content. Auth logging only needs bounded error metadata.
      if (reqPath.startsWith("/api/auth/") && bodyJson && typeof bodyJson === "object") {
        capturedAuthError = {
          ...(typeof bodyJson.error === "string"
            ? { error: bodyJson.error.slice(0, 150) }
            : {}),
          ...(typeof bodyJson.code === "string"
            ? { code: bodyJson.code.slice(0, 80) }
            : {}),
        };
      }
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    if (reqPath.startsWith("/api/auth/") && (req.method === "POST" || req.method === "PUT")) {
      const forwarded = req.headers["x-forwarded-for"];
      const clientIp = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.socket.remoteAddress || "unknown";
      log("info", `[AUTH] attempt ${req.method} ${reqPath}`, {
        event: "auth_attempt",
        action: reqPath.replace("/api/auth/", ""),
        method: req.method,
        ip: clientIp,
        userAgent: (req.headers["user-agent"] || "").slice(0, 100),
      });
    }

    res.on("finish", () => {
      if (!reqPath.startsWith("/api")) return;

      const duration = Date.now() - start;

      const meta: Record<string, unknown> = {
        method: req.method,
        path: reqPath,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
      };

      if (reqPath.startsWith("/api/auth/")) {
        const forwarded = req.headers["x-forwarded-for"];
        const clientIp = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : req.socket.remoteAddress || "unknown";
        const authEvent: Record<string, unknown> = {
          event: "auth",
          action: reqPath.replace("/api/auth/", ""),
          method: req.method,
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          ip: clientIp,
          userAgent: (req.headers["user-agent"] || "").slice(0, 100),
        };
        if (capturedAuthError?.error) {
          authEvent.errorMessage = capturedAuthError.error;
        }
        if (capturedAuthError?.code) {
          authEvent.errorCode = capturedAuthError.code;
        }
        const authLevel: LogLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
        log(authLevel, `[AUTH] ${req.method} ${reqPath} ${res.statusCode}`, authEvent);
      }

      const level: LogLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      log(level, `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`, meta);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.displayName || appJson.name || "Proset";
  } catch {
    return "Proset";
  }
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const canonicalBase = "https://proset.ai";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host") || "proset.ai";

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, canonicalBase)
    .replace(/EXPS_URL_PLACEHOLDER/g, host)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  const etag = `"${crypto.createHash("md5").update(html).digest("hex")}"`;

  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.setHeader("ETag", etag);
  res.status(200).send(html);
}

function isSocialCrawler(req: Request): boolean {
  const ua = (req.headers["user-agent"] || "").toLowerCase();
  const crawlers = [
    "whatsapp", "telegrambot", "twitterbot", "facebookexternalhit",
    "linkedinbot", "slackbot", "discordbot", "skypeuripreview",
    "pinterest", "redditbot", "iframely", "embedly",
  ];
  return crawlers.some((c) => ua.includes(c));
}

// setupLandingPageRoutes is called early in the startup chain (before auth
// middleware) so that social crawlers and unauthenticated visitors always
// receive the static landing page with rich OG metadata at / — no redirect,
// no SPA load, no auth gate.
function setupLandingPageRoutes(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  if (!fs.existsSync(templatePath)) {
    console.warn("[startup] WARN: landing-page.html not found — skipping landing page routes");
    return;
  }
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();

  app.get("/", (req: Request, res: Response) => {
    serveLandingPage({ req, res, landingPageTemplate, appName });
  });

  // Support form — static HTML, no auth required
  const supportTemplatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "support-form.html",
  );
  if (fs.existsSync(supportTemplatePath)) {
    const supportTemplate = fs.readFileSync(supportTemplatePath, "utf-8");
    const turnstileSiteKey = process.env.AIFORMS_PUBLIC_TURNSTILE_SITE_KEY || "";
    const supportHtml = supportTemplate.replace(
      /TURNSTILE_SITE_KEY_PLACEHOLDER/g,
      turnstileSiteKey
    );
    app.get("/support", (_req: Request, res: Response) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.status(200).send(supportHtml);
    });

    // Thank-you page
    const thanksTemplatePath = path.resolve(
      process.cwd(),
      "server",
      "templates",
      "support-thanks.html",
    );
    if (fs.existsSync(thanksTemplatePath)) {
      const thanksTemplate = fs.readFileSync(thanksTemplatePath, "utf-8");
      app.get("/support/thanks", (_req: Request, res: Response) => {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=300");
        res.status(200).send(thanksTemplate);
      });
    }

    // Support ticket submission — no auth, Turnstile-protected
    app.post("/api/support", express.json({ limit: "50kb" }), async (req: Request, res: Response) => {
      try {
        const { name, email, subject, category, message, turnstileToken } = req.body;

        if (!name || !email || !subject || !message) {
          return res.status(400).json({ error: "All fields are required." });
        }

        // Require Turnstile token — no bypass
        const secretKey = process.env.TURNSTILE_SECRET_KEY;
        if (!secretKey) {
          console.error("TURNSTILE_SECRET_KEY not configured");
          return res.status(500).json({ error: "Server configuration error. Please email support@proset.ai." });
        }
        if (!turnstileToken || typeof turnstileToken !== "string" || !turnstileToken.trim()) {
          return res.status(400).json({ error: "CAPTCHA verification required. Please complete the challenge." });
        }

        const formData = new URLSearchParams();
        formData.append("secret", secretKey);
        formData.append("response", turnstileToken.trim());
        const cfRes = await globalThis.fetch(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          { method: "POST", body: formData }
        );
        const cfData = (await cfRes.json()) as { success: boolean };
        if (!cfData.success) {
          return res.status(400).json({ error: "CAPTCHA verification failed. Please try again." });
        }

        const { sendSupportTicketEmail, sendSupportAcknowledgmentEmail } = await import("./email-service");
        await sendSupportTicketEmail({
          name: String(name).trim(),
          email: String(email).trim().toLowerCase(),
          subject: String(subject).trim(),
          category: String(category || "general").trim(),
          message: String(message).trim(),
        });

        // Send acknowledgment email to the submitter (fire-and-forget)
        sendSupportAcknowledgmentEmail({
          name: String(name).trim(),
          email: String(email).trim().toLowerCase(),
          subject: String(subject).trim(),
          category: String(category || "general").trim(),
          message: String(message).trim(),
        }).catch((err: any) => console.error("Ack email failed:", err.message));

        res.json({ ok: true });
      } catch (error: any) {
        console.error("Support ticket submission error:", error);
        res.status(500).json({ error: "Failed to submit ticket. Please email support@proset.ai." });
      }
    });
  } else {
    console.warn("[startup] WARN: support-form.html not found — /support will 404");
  }
}

function configureWebAndLanding(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();

  app.get("/api/documentation", (_req: Request, res: Response) => {
    res.redirect("/documentation/");
  });

  app.get("/delete-data", (_req: Request, res: Response) => {
    // Redirect to the ABSOLUTE canonical URL. The docs (including the
    // delete-data guide) are served from Cloudflare Pages, not this Cloud Run
    // origin — a relative redirect would land on the `/documentation` 404
    // below. Pointing straight at the trailing-slash URL also avoids a second
    // Docusaurus 308 redirect, which breaks Google Play's data-safety link
    // validator (Play rejects multi-hop redirect chains).
    res.redirect(301, "https://proset.ai/documentation/delete-data/");
  });

  const landingCssPath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.css",
  );
  app.get("/landing-page.css", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/css; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(landingCssPath);
  });

  app.get("/robots.txt", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    if (process.env.ROBOTS_NOINDEX === "true") {
      res.status(200).send("User-agent: *\nDisallow: /");
      return;
    }
    const canonicalBase = "https://proset.ai";
    const robotsTxt = [
      "User-agent: *",
      "Allow: /",
      "Allow: /documentation/",
      "Disallow: /api/",
      "",
      "# AI crawlers — explicitly welcome (training + retrieval)",
      "User-agent: GPTBot",
      "Allow: /",
      "",
      "User-agent: OAI-SearchBot",
      "Allow: /",
      "",
      "User-agent: ChatGPT-User",
      "Allow: /",
      "",
      "User-agent: ClaudeBot",
      "Allow: /",
      "",
      "User-agent: PerplexityBot",
      "Allow: /",
      "",
      "User-agent: CCBot",
      "Allow: /",
      "",
      "User-agent: Google-Extended",
      "Allow: /",
      "",
      "User-agent: Applebot-Extended",
      "Allow: /",
      "",
      "User-agent: Meta-ExternalAgent",
      "Allow: /",
      "",
      `Sitemap: ${canonicalBase}/sitemap.xml`,
    ].join("\n");
    res.status(200).send(robotsTxt);
  });

  const llmsTxtPath = path.resolve(process.cwd(), "server", "templates", "llms.txt");
  const llmsFullTxtPath = path.resolve(process.cwd(), "server", "templates", "llms-full.txt");
  app.get("/llms.txt", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.sendFile(llmsTxtPath);
  });
  app.get("/llms-full.txt", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.sendFile(llmsFullTxtPath);
  });

  app.get("/sitemap.xml", (_req: Request, res: Response) => {
    const canonicalBase = "https://proset.ai";
    const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${canonicalBase}/sitemap-main.xml</loc>
  </sitemap>
  <sitemap>
    <loc>${canonicalBase}/documentation/sitemap.xml</loc>
  </sitemap>
</sitemapindex>`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.status(200).send(sitemapIndex);
  });

  app.get("/sitemap-main.xml", (_req: Request, res: Response) => {
    const canonicalBase = "https://proset.ai";
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${canonicalBase}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${canonicalBase}/documentation/</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${canonicalBase}/privacy</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${canonicalBase}/refund</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.status(200).send(sitemap);
  });

  // Docusaurus docs are served statically from Cloudflare Pages
  // (proset-docs project via the edge router at /documentation*).
  // Kept as an explicit 404 for any direct Cloud Run origin hits.
  app.use("/documentation", (_req: Request, res: Response) => {
    res.status(404).send("Documentation is served from https://proset.ai/documentation");
  });

  const webDistPath = path.resolve(process.cwd(), "web-build");
  const hasWebBuild = fs.existsSync(path.join(webDistPath, "index.html"));

  if (hasWebBuild) {
    log("info", "Web build found - serving web app to browser visitors");
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    // / is handled by setupLandingPageRoutes (registered before auth middleware)
    if (req.path === "/") {
      return next();
    }

    if (req.path !== "/welcome") {
      return next();
    }

    // /welcome always shows the landing page (advertising)
    return serveLandingPage({ req, res, landingPageTemplate, appName });
  });

  const staticCacheOptions = { maxAge: "7d", immutable: false };
  const immutableCacheOptions = { maxAge: "365d", immutable: true };

  // Service worker must never be cached — browsers check for updates on navigation
  app.get("/service-worker.js", (_req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    next();
  });

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets"), staticCacheOptions));
  app.use(express.static(path.resolve(process.cwd(), "public"), staticCacheOptions));

  if (hasWebBuild) {
    const webBuildAssetsDir = path.join(webDistPath, "assets");
    app.use("/assets", (req: Request, res: Response, next: NextFunction) => {
      const assetPath = path.join(webBuildAssetsDir, req.path);
      if (fs.existsSync(assetPath) && !fs.statSync(assetPath).isDirectory()) {
        return res.sendFile(assetPath);
      }
      next();
    });

    const webIndexPath = path.join(webDistPath, "index.html");
    const publicDirPath = path.resolve(process.cwd(), "public");

    app.get("*splat", (req: Request, res: Response, next: NextFunction) => {
      if (!hasWebBuild) {
        return next();
      }

      if (req.path === "/") {
        return next();
      }

      const reservedPrefixes = ["/api", "/documentation", "/assets", "/support"];
      if (reservedPrefixes.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
        return next();
      }

      if (path.extname(req.path)) {
        return next();
      }

      // Serve language-specific index for social crawlers
      const acceptLang = req.headers["accept-language"] || "";
      const wantsSpanish = acceptLang.includes("es") && !acceptLang.includes("en");
      const indexFile = wantsSpanish
        ? path.join(publicDirPath, "index-es.html")
        : webIndexPath;

      return res.sendFile(indexFile);
    });
  }

  log("info", "Web routing initialized");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    log("error", "Internal Server Error", { error: String(err) });

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}

process.on("uncaughtException", (err) => {
  log("error", "Uncaught exception — process will continue", { error: err.message, stack: err.stack });
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  log("error", "Unhandled promise rejection", { error: msg, stack });
});

let httpServer: ReturnType<typeof import("http").createServer> | null = null;

function gracefulShutdown(signal: string) {
  log("info", `Received ${signal}, shutting down gracefully`);
  if (httpServer) {
    httpServer.close(() => {
      log("info", "HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => {
      log("warn", "Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

function extractHost(hostOrOrigin: string): string {
  return hostOrOrigin.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function isLocalOrigin(hostOrOrigin: string): boolean {
  const host = extractHost(hostOrOrigin);
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

function normalizeOrigin(hostOrOrigin: string): string {
  const trimmed = hostOrOrigin.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const protocol = isLocalOrigin(trimmed) ? "http" : "https";
  return `${protocol}://${trimmed}`;
}

function getPublicBaseUrl(): string | null {
  if (process.env.PUBLIC_APP_URL) {
    return normalizeOrigin(process.env.PUBLIC_APP_URL);
  }

  if (process.env.AIFORMS_PUBLIC_DOMAIN) {
    return normalizeOrigin(process.env.AIFORMS_PUBLIC_DOMAIN);
  }

  return null;
}

function validateEnvironment(): void {
  console.log("[startup] Checking environment variables...");

  const requiredVars = [
    { name: "BETTER_AUTH_SECRET", purpose: "session and auth signing" },
  ];

  const missingRequired: string[] = [];

  for (const { name, purpose } of requiredVars) {
    if (process.env[name]) {
      console.log(`[startup] OK: ${name}`);
    } else {
      console.error(`[startup] ERROR: ${name} missing — required for ${purpose}`);
      missingRequired.push(name);
    }
  }

  const openAiApiKey = getOpenAIApiKey();
  if (openAiApiKey) {
    const source = process.env.PROSET_OPENAI_API_KEY ? "PROSET_OPENAI_API_KEY" : process.env.AI_INTEGRATIONS_OPENAI_API_KEY ? "AI_INTEGRATIONS_OPENAI_API_KEY" : "OPENAI_API_KEY";
    console.log(`[startup] OK: ${source}`);
  } else {
    console.error("[startup] ERROR: OPENAI_API_KEY missing — required for transcription and AI processing");
    missingRequired.push("OPENAI_API_KEY");
  }

  const openAiBaseUrl = getOpenAIBaseUrl();
  if (openAiBaseUrl) {
    console.log(`[startup] INFO: OpenAI base URL set to ${openAiBaseUrl}`);
  } else {
    console.log("[startup] INFO: Using default OpenAI API base URL");
  }

  // Validate transcription providers
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    console.log("[startup] OK: GROQ_API_KEY (primary transcription)");
  } else {
    console.warn("[startup] WARN: GROQ_API_KEY missing — transcription will start with the next configured provider");
  }

  if (process.env.MISTRAL_API_KEY) {
    console.log("[startup] OK: MISTRAL_API_KEY (first transcription fallback)");
  } else {
    console.warn("[startup] WARN: MISTRAL_API_KEY missing — skipping Voxtral transcription fallback");
  }

  const transcriptionRoutes = getTranscriptionRoutes();
  console.log(
    `[startup] Transcription routing: ${transcriptionRoutes.map(({ provider }) => provider).join(" → ") || "none"} (latency-first hedged, total budget: ${getTranscriptionTotalTimeoutMs()}ms)`,
  );

  if (hasDedicatedAIProviderConfig("deepseek")) {
    console.log(
      `[startup] OK: DeepSeek conversion tiering (regular: ${process.env.AI_DEEPSEEK_FLASH_MODEL || "deepseek-v4-flash"}; advanced: ${process.env.AI_DEEPSEEK_PRO_MODEL || "deepseek-v4-pro"})`,
    );
  } else {
    console.warn("[startup] WARN: DeepSeek conversion primary is not configured — conversions will use configured fallbacks");
  }

  if (missingRequired.length > 0) {
    console.error(`[startup] FATAL: Missing required environment variables: ${missingRequired.join(", ")}`);
    console.error("[startup] Server cannot start without these variables. Exiting.");
    process.exit(1);
  }

  if (!process.env.SENDGRID_API_KEY) {
    console.warn("[startup] WARN: SENDGRID_API_KEY missing — email features disabled (verification, password reset, welcome)");
  }

  const hasGoogleId = !!process.env.GOOGLE_CLIENT_ID;
  const hasGoogleSecret = !!process.env.GOOGLE_CLIENT_SECRET;
  if (!hasGoogleId && !hasGoogleSecret) {
    console.warn("[startup] WARN: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET missing — Google OAuth disabled");
  } else if (!hasGoogleId || !hasGoogleSecret) {
    console.warn(`[startup] WARN: Only ${hasGoogleId ? "GOOGLE_CLIENT_ID" : "GOOGLE_CLIENT_SECRET"} is set — Google OAuth requires both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET`);
  }

  const hasGithubId = !!process.env.GITHUB_CLIENT_ID;
  const hasGithubSecret = !!process.env.GITHUB_CLIENT_SECRET;
  if (!hasGithubId && !hasGithubSecret) {
    console.warn("[startup] WARN: GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET missing — GitHub OAuth disabled");
  } else if (!hasGithubId || !hasGithubSecret) {
    console.warn(`[startup] WARN: Only ${hasGithubId ? "GITHUB_CLIENT_ID" : "GITHUB_CLIENT_SECRET"} is set — GitHub OAuth requires both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET`);
  }



  console.log("[startup] All critical variables present. Starting server...");
}

(async () => {
  validateEnvironment();


  if (isStripeBillingEnabled()) {
    try {
      await stripeService.backfillLegacyBillingState();
    } catch (error) {
      log("warn", "Failed to backfill legacy billing state", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    log("info", "Stripe billing disabled for this environment");
  }

  app.set("trust proxy", 1);

  // Mark non-indexed deployments via env
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (process.env.ROBOTS_NOINDEX === "true") {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
    }
    next();
  });

  setupSecurityHeaders(app);
  setupRequestId(app);
  setupCors(app);

  // Landing page must be served BEFORE auth middleware so social crawlers
  // and unauthenticated visitors always get static HTML with OG metadata.
  // Registered as explicit route handlers here; /welcome is handled in
  // configureWebAndLanding for the full template+CSS experience.
  setupLandingPageRoutes(app);

  // Service-to-service routes carry their own authorization:
  // - /api/internal/* verifies a Cloud Tasks OIDC token.
  // - /api/revenuecat/webhook verifies its configured bearer secret.
  // Passing either bearer token through firebaseAuthMiddleware first creates
  // a permanent, spurious "Firebase auth verification failed" log entry.
  // Skip Firebase auth for those independently authenticated routes.
  app.use((req, res, next) => {
    if (
      req.path.startsWith("/api/internal/")
      || req.path === "/api/revenuecat/webhook"
    ) return next();
    return firebaseAuthMiddleware(req, res, next);
  });

  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    async (req: Request, res: Response) => {
      if (!isStripeBillingEnabled()) {
        return res.status(503).json({ error: "Billing is disabled in this environment." });
      }
      const signature = req.headers['stripe-signature'];
      if (!signature) {
        return res.status(400).json({ error: 'Missing stripe-signature' });
      }
      try {
        const sig = Array.isArray(signature) ? signature[0] : signature;
        if (!Buffer.isBuffer(req.body)) {
          log("error", "Stripe webhook: req.body is not a Buffer");
          return res.status(500).json({ error: 'Webhook processing error' });
        }
        await WebhookHandlers.processWebhook(req.body as Buffer, sig);
        res.status(200).json({ received: true });
      } catch (error: any) {
        log("error", "Stripe webhook error", { error: error.message });
        const status = error?.name === "StripeWebhookSignatureError" ? 400 : 500;
        res.status(status).json({ error: 'Webhook processing error' });
      }
    }
  );

  app.post(
    '/api/revenuecat/webhook',
    express.json(),
    handleRevenueCatWebhook
  );

  setupRateLimiting(app);
  setupRequestLogging(app);

  const healthLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: (req) => req.hostname === "localhost" || req.hostname === "127.0.0.1" || process.env.DISABLE_RATE_LIMIT === "true",
  });

  app.get("/health", healthLimiter, async (_req: Request, res: Response) => {
    const checks: Record<string, { status: string; type?: string; latencyMs?: number; error?: string }> = {};

    try {
      const dbStart = Date.now();
      const { storage } = await import("./storage");
      const dbHealth = await storage.checkHealth();
      if (dbHealth.status === "ok") {
        checks.database = { status: "ok", type: dbHealth.type, latencyMs: Date.now() - dbStart };
      } else {
        checks.database = { status: "error", type: dbHealth.type, error: dbHealth.error || "Database unreachable" };
      }
    } catch (e: any) {
      checks.database = { status: "error", error: e.message || "Database unreachable" };
    }

    if (!isStripeBillingEnabled()) {
      checks.stripe = { status: "disabled" };
    } else if (process.env.STRIPE_SECRET_KEY) {
      try {
        const { getUncachableStripeClient } = await import("./stripe-client");
        await getUncachableStripeClient();
        checks.stripe = { status: "ok" };
      } catch {
        checks.stripe = { status: "error", error: "Stripe client initialization failed" };
      }
    } else {
      checks.stripe = { status: "skipped", error: "Stripe not configured" };
    }

    try {
      const { isEmailServiceAvailable } = await import("./email-service");
      if (isEmailServiceAvailable()) {
        checks.email = { status: "ok" };
      } else {
        checks.email = { status: "error", error: "Email service not configured" };
      }
    } catch {
      checks.email = { status: "error", error: "Email service not loaded" };
    }

    try {
      checks.auth = { status: "ok" };
    } catch {
      checks.auth = { status: "error", error: "Auth check failed" };
    }

    const dbFailed = checks.database?.status !== "ok";
    const anyFailed = Object.values(checks).some((c) => c.status === "error");
    const topStatus = dbFailed ? "unhealthy" : anyFailed ? "degraded" : "healthy";
    const httpStatus = dbFailed ? 503 : 200;

    res.status(httpStatus).json({
      status: topStatus,
      timestamp: new Date().toISOString(),
      checks,
    });
  });



  const authRouter = express.Router();
  authRouter.use(express.json({ limit: "50mb" }));
  authRouter.use(cookieParser());
  setupAuthRoutes(authRouter);
  app.use(authRouter);



  setupBodyParsing(app);
  app.use(cookieParser());

  setupCsrfProtection(app);

  setupMatrixWellKnown(app);

  app.get("/api/health", async (_req: Request, res: Response) => {
    const { storage } = await import("./storage");
    const dbHealth = await storage.checkHealth().catch(() => ({ status: "error", type: "unknown" }));
    let billingHealth: { status: "ok" | "error" | "skipped" | "disabled"; mode?: string; error?: string };
    if (!isStripeBillingEnabled()) {
      billingHealth = { status: "disabled", mode: "disabled" };
    } else if (!process.env.STRIPE_SECRET_KEY) {
      billingHealth = { status: "skipped", error: "Stripe not configured" };
    } else {
      try {
        const { getUncachableStripeClient } = await import("./stripe-client");
        await getUncachableStripeClient();
        billingHealth = { status: "ok", mode: getExpectedStripeMode() || "unspecified" };
      } catch {
        billingHealth = { status: "error", error: "Stripe environment safety check failed" };
      }
    }
    const healthy = dbHealth.status === "ok" && billingHealth.status !== "error";
    res.json({
      status: healthy ? "ok" : "degraded",
      database: dbHealth,
      billing: billingHealth,
      uptime: process.uptime(),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      deployment: getPublicDeploymentInfo(),
    });
  });

  configureWebAndLanding(app);

  const server = await registerRoutes(app);

  setupErrorHandler(app);

  async function ensureDbSchema() {
    try {
      const { db } = await import('./storage');
      const { sql } = await import('drizzle-orm');

      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS user_modules (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR NOT NULL,
          module_name VARCHAR NOT NULL,
          assigned_by VARCHAR NOT NULL,
          assigned_at TIMESTAMP DEFAULT NOW() NOT NULL
        )
      `);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS user_modules_user_module_idx ON user_modules (user_id, module_name)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS user_modules_user_id_idx ON user_modules (user_id)`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS bucket_files (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          bucket_key TEXT NOT NULL UNIQUE,
          original_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_size INTEGER NOT NULL DEFAULT 0,
          category TEXT NOT NULL DEFAULT 'file',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS bucket_files_user_id_idx ON bucket_files (user_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS bucket_files_category_idx ON bucket_files (category)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS bucket_files_bucket_key_idx ON bucket_files (bucket_key)`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS user_ai_model_preferences (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          regular_model_id TEXT,
          advanced_model_id TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);
      await db.execute(sql`ALTER TABLE user_ai_model_preferences ADD COLUMN IF NOT EXISTS regular_model_id TEXT`);
      await db.execute(sql`ALTER TABLE user_ai_model_preferences ADD COLUMN IF NOT EXISTS advanced_model_id TEXT`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS user_ai_model_preferences_user_unique ON user_ai_model_preferences (user_id)`);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS session (
          id VARCHAR PRIMARY KEY,
          expires_at TIMESTAMP NOT NULL,
          token TEXT NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          ip_address TEXT,
          user_agent TEXT,
          user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS account (
          id VARCHAR PRIMARY KEY,
          account_id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          access_token TEXT,
          refresh_token TEXT,
          id_token TEXT,
          access_token_expires_at TIMESTAMP,
          refresh_token_expires_at TIMESTAMP,
          scope TEXT,
          password TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS verification (
          id VARCHAR PRIMARY KEY,
          identifier TEXT NOT NULL,
          value TEXT NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);

      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS image TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL`);

      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_last_changed TIMESTAMP`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled INTEGER NOT NULL DEFAULT 0`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_backup_codes TEXT`);
      const colCheck = await db.execute(sql`
        SELECT data_type FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'email_verified'
      `);
      const rows = colCheck as any;
      const currentType = rows?.rows?.[0]?.data_type;
      if (currentType === 'boolean') {
        await db.execute(sql`
          ALTER TABLE users 
          ALTER COLUMN email_verified DROP DEFAULT
        `);
        await db.execute(sql`
          ALTER TABLE users 
          ALTER COLUMN email_verified TYPE integer USING CASE 
            WHEN email_verified THEN 1 ELSE 0
          END
        `);
        await db.execute(sql`
          ALTER TABLE users 
          ALTER COLUMN email_verified SET DEFAULT 0
        `);
        log("info", "Migrated email_verified from boolean to integer");
      }

    } catch (err: any) {
      log("warn", "Schema alignment check failed", { error: err.message });
    }
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer = server;
  server.listen(
    {
      port,
      host: "0.0.0.0",
      ...(process.platform === "win32" ? {} : { reusePort: true }),
    },
    () => {
      log("info", `Express server serving on port ${port}`);
      ensureDbSchema().catch(err => log("warn", "Schema alignment failed", { error: String(err) }));
      runAuthHealthCheck();
    },
  );
})();

async function runAuthHealthCheck() {
  const checks: { check: string; status: "ok" | "warn" | "error"; detail?: string }[] = [];

  if (process.env.SENDGRID_API_KEY) {
    checks.push({ check: "email_service", status: "ok" });
  } else {
    checks.push({ check: "email_service", status: "warn", detail: "SENDGRID_API_KEY not set - verification/reset emails will fail" });
  }

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    checks.push({ check: "google_oauth", status: "ok" });
  } else {
    checks.push({ check: "google_oauth", status: "warn", detail: "Google OAuth credentials not configured" });
  }

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    checks.push({ check: "github_oauth", status: "ok" });
  } else {
    checks.push({ check: "github_oauth", status: "warn", detail: "GitHub OAuth credentials not configured" });
  }

  if (process.env.TURNSTILE_SECRET_KEY) {
    checks.push({ check: "turnstile_captcha", status: "ok" });
  } else {
    checks.push({ check: "turnstile_captcha", status: "warn", detail: "Turnstile CAPTCHA not configured - registration unprotected" });
  }

  if (process.env.DATABASE_URL) {
    checks.push({ check: "database", status: "ok" });
  } else {
    checks.push({ check: "database", status: "error", detail: "DATABASE_URL not set" });
  }

  const domain = process.env.PUBLIC_APP_URL || process.env.AIFORMS_PUBLIC_DOMAIN;
  if (domain) {
    checks.push({ check: "cookie_domain", status: "ok", detail: domain });
  } else {
    checks.push({ check: "cookie_domain", status: "warn", detail: "No app domain detected (PUBLIC_APP_URL / AIFORMS_PUBLIC_DOMAIN) - cookies may not work" });
  }

  try {
    const { storage } = await import("./storage");
    const list = await storage.sessions.list();
    checks.push({ check: "sessions_table", status: "ok", detail: `${list.length} sessions` });
  } catch (err: any) {
    checks.push({ check: "sessions_table", status: "error", detail: `Sessions table inaccessible: ${err.message?.slice(0, 80)}` });
  }

  const betterAuthBasePath = "/api/auth";
  const expectedBaseUrl = domain ? (domain.startsWith("http") ? domain : `https://${domain}`) : "https://proset.ai";
  checks.push({ check: "better_auth_config", status: "ok", detail: `basePath=${betterAuthBasePath}, baseUrl=${expectedBaseUrl}` });

  const warnings = checks.filter(c => c.status === "warn");
  const errors = checks.filter(c => c.status === "error");

  if (errors.length > 0) {
    log("error", `Auth health check: ${errors.length} error(s)`, { checks: errors });
  }
  if (warnings.length > 0) {
    log("warn", `Auth health check: ${warnings.length} warning(s)`, { checks: warnings });
  }
  if (errors.length === 0 && warnings.length === 0) {
    log("info", "Auth health check: all checks passed");
  }
}
