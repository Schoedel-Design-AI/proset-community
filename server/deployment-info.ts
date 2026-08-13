import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type DeploymentSource = "env" | "file" | "git" | "missing";

interface FileDeploymentMetadata {
  gitSha?: string | null;
  branch?: string | null;
  builtAt?: string | null;
  version?: string | null;
}

export interface AndroidDeploymentRecord {
  track: string;
  versionCode: number;
  versionName: string;
  uploadedAt: string;
}

export interface DeploymentInfo {
  gitSha: string | null;
  shortSha: string | null;
  branch: string | null;
  builtAt: string | null;
  startedAt: string;
  version: string | null;
  android: AndroidDeploymentRecord | null;
  sources: {
    gitSha: DeploymentSource;
    branch: DeploymentSource;
    builtAt: DeploymentSource;
  };
}

interface ResolveOptions {
  execCommand?: (command: string) => string;
  now?: string;
  packageVersion?: string | null;
  fileMetadata?: FileDeploymentMetadata | null;
}

function normalizeMetadataValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (["unknown", "undefined", "null", "n/a", "none"].includes(lowered)) {
    return null;
  }
  return trimmed;
}

function getPackageVersion(): string | null {
  try {
    const raw = readFileSync(fileURLToPath(new URL("../package.json", import.meta.url).toString()), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return normalizeMetadataValue(parsed.version);
  } catch {
    return null;
  }
}

function getFileMetadata(): FileDeploymentMetadata | null {
  try {
    const raw = readFileSync(fileURLToPath(new URL("../deployment-info.json", import.meta.url).toString()), "utf8");
    const parsed = JSON.parse(raw) as FileDeploymentMetadata;
    return {
      gitSha: normalizeMetadataValue(parsed.gitSha),
      branch: normalizeMetadataValue(parsed.branch),
      builtAt: normalizeMetadataValue(parsed.builtAt),
      version: normalizeMetadataValue(parsed.version),
    };
  } catch {
    return null;
  }
}

const GIT_SHA_ENV_KEYS = [
  "APP_GIT_SHA",
  "GIT_SHA",
  "CI_COMMIT_SHA",
  "SOURCE_COMMIT",
  "DOKPLOY_GIT_COMMIT",
  "VERCEL_GIT_COMMIT_SHA",
  "RAILWAY_GIT_COMMIT_SHA",
] as const;

const BRANCH_ENV_KEYS = [
  "APP_GIT_BRANCH",
  "GIT_BRANCH",
  "CI_COMMIT_REF_NAME",
  "SOURCE_BRANCH",
  "DOKPLOY_GIT_BRANCH",
  "VERCEL_GIT_COMMIT_REF",
  "RAILWAY_GIT_BRANCH",
] as const;

const BUILD_TIME_ENV_KEYS = [
  "APP_BUILD_TIME",
  "BUILD_TIME",
  "BUILT_AT",
  "CI_JOB_STARTED_AT",
] as const;

function getFirstEnvValue(env: NodeJS.ProcessEnv, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = normalizeMetadataValue(env[key]);
    if (value) return value;
  }
  return null;
}

function runGitCommand(command: string, execCommand: (command: string) => string): string | null {
  try {
    const value = execCommand(command).trim();
    return value || null;
  } catch {
    return null;
  }
}

export function resolveDeploymentInfo(
  env: NodeJS.ProcessEnv = process.env,
  options: ResolveOptions = {},
): DeploymentInfo {
  const execCommand = options.execCommand ?? ((command: string) => execSync(command, { encoding: "utf8" }));
  const fileMetadata = options.fileMetadata ?? getFileMetadata();

  const envGitSha = getFirstEnvValue(env, GIT_SHA_ENV_KEYS);
  const gitSha = envGitSha ?? fileMetadata?.gitSha ?? runGitCommand("git rev-parse HEAD", execCommand);

  const envBranch = getFirstEnvValue(env, BRANCH_ENV_KEYS);
  const branch = envBranch ?? fileMetadata?.branch ?? runGitCommand("git rev-parse --abbrev-ref HEAD", execCommand);

  const envBuiltAt = getFirstEnvValue(env, BUILD_TIME_ENV_KEYS);
  const builtAt = envBuiltAt ?? fileMetadata?.builtAt ?? null;
  const startedAt = options.now ?? new Date().toISOString();
  const version = options.packageVersion ?? fileMetadata?.version ?? getPackageVersion();

  // Read latest Android deployment record (written by upload-aab.py)
  let android: AndroidDeploymentRecord | null = null;
  try {
    // Server runs from /app/server_dist/, scripts/ is at /app/scripts/
    const androidPath = join(process.cwd(), "..", "scripts", "android-deployments.json");
    const raw = readFileSync(androidPath, "utf-8");
    const records: AndroidDeploymentRecord[] = JSON.parse(raw);
    if (Array.isArray(records) && records.length > 0) {
      android = records[0]; // most recent is first
    }
  } catch {
    // File doesn't exist or is malformed — not critical
  }

  return {
    gitSha,
    shortSha: gitSha ? gitSha.slice(0, 7) : null,
    branch,
    builtAt,
    startedAt,
    version,
    android,
    sources: {
      gitSha: envGitSha ? "env" : fileMetadata?.gitSha ? "file" : gitSha ? "git" : "missing",
      branch: envBranch ? "env" : fileMetadata?.branch ? "file" : branch ? "git" : "missing",
      builtAt: envBuiltAt ? "env" : fileMetadata?.builtAt ? "file" : "missing",
    },
  };
}

const deploymentInfo = resolveDeploymentInfo();

export function getDeploymentInfo(): DeploymentInfo {
  return deploymentInfo;
}

export function getPublicDeploymentInfo() {
  return {
    gitSha: deploymentInfo.gitSha,
    shortSha: deploymentInfo.shortSha,
    builtAt: deploymentInfo.builtAt,
    version: deploymentInfo.version,
  };
}