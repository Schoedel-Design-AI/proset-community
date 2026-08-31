import { Octokit } from "@octokit/rest";

type FeedbackWorkItemOptions = {
  category: string;
  message: string;
  userEmail?: string;
  userName?: string;
  userNumber?: string;
  /** "Android app 1.0.61 (build 96) · Android 14 · Pixel 7" */
  reportedFrom?: string;
  /** "android" | "ios" | "web" — the surface the report was filed from. */
  reportedSurface?: string;
  /** "Android + Web" — every surface this account has been seen on. */
  accountSurfaces?: string;
  /** True when the account uses more than one surface. */
  crossSurface?: boolean;
};

type GitHubIssueResponse = {
  number: number;
  web_url: string;
};

function getGitHubConfig() {
  const token = (
    process.env.GITHUB_TOKEN ||
    process.env.GITHUB_ACCESS_TOKEN ||
    process.env.GITHUB_API_KEY ||
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN
  )?.trim();
  const repo = (process.env.GITHUB_REPO || "Schoedel-Design-AI/proset-community")?.trim();

  return { token, repo };
}

export function isGitHubFeedbackSyncConfigured(): boolean {
  const { token, repo } = getGitHubConfig();
  return !!(token && repo);
}

function buildIssueTitle(category: string, message: string): string {
  const summary = message.replace(/\s+/g, " ").trim().slice(0, 90);
  return `[Feedback] ${category}${summary ? `: ${summary}` : ""}`.slice(0, 255);
}

function buildIssueDescription(opts: FeedbackWorkItemOptions): string {
  const submittedBy = opts.userName || "Unknown user";
  const submittedAt = new Date().toISOString();
  const userLines = [
    `Submitted by: ${submittedBy}`,
    opts.userEmail ? `User email: ${opts.userEmail}` : null,
    opts.userNumber ? `User number: ${opts.userNumber}` : null,
    `Submitted at: ${submittedAt}`,
    "Source: Proset in-app feedback modal",
    opts.reportedFrom ? `Reported from: ${opts.reportedFrom}` : null,
    opts.accountSurfaces ? `Account surfaces: ${opts.accountSurfaces}` : null,
  ].filter(Boolean);

  return [
    "## Proset Feedback Submission",
    "",
    `Category: ${opts.category}`,
    ...userLines,
    "",
    ...(opts.crossSurface
      ? [
          "> Reproduce on **both** surfaces before closing: this account uses " +
            `${opts.accountSurfaces}, and Proset ships one React Native codebase to all of them.`,
          "",
        ]
      : []),
    "## Message",
    "",
    opts.message.trim(),
  ].join("\n");
}

/**
 * Labels: the surface the report came FROM, plus a cross-surface flag when the
 * account also uses another one. `platform:android` alone would read as
 * "Android-only bug", which is usually wrong — the same TypeScript ships to the
 * browser, so the filter that matters during triage is "does this need a web
 * check too?".
 */
function buildIssueLabels(opts: FeedbackWorkItemOptions): string[] {
  const labels = ["feedback", opts.category.toLowerCase()];
  const surface = opts.reportedSurface?.toLowerCase();
  if (surface === "android" || surface === "ios" || surface === "web") {
    labels.push(`platform:${surface}`);
  }
  if (opts.crossSurface) labels.push("platform:cross-surface");
  return labels.filter(Boolean);
}

export async function createFeedbackGitHubIssue(
  opts: FeedbackWorkItemOptions
): Promise<GitHubIssueResponse | null> {
  const { token, repo } = getGitHubConfig();
  if (!token || !repo) return null;

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    throw new Error("Invalid GITHUB_REPO format. Must be 'owner/repo'.");
  }

  const octokit = new Octokit({ auth: token });
  const response = await octokit.rest.issues.create({
    owner,
    repo: repoName,
    title: buildIssueTitle(opts.category, opts.message),
    body: buildIssueDescription(opts),
    labels: buildIssueLabels(opts),
  });

  return {
    number: response.data.number,
    web_url: response.data.html_url,
  };
}

export async function createGitHubIssue(
  title: string,
  body: string,
  labels: string[] = ["bug"]
): Promise<GitHubIssueResponse | null> {
  const { token, repo } = getGitHubConfig();
  if (!token || !repo) return null;

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    throw new Error("Invalid GITHUB_REPO format. Must be 'owner/repo'.");
  }

  const octokit = new Octokit({ auth: token });
  const response = await octokit.rest.issues.create({
    owner,
    repo: repoName,
    title: title.trim(),
    body: body.trim(),
    labels,
  });

  return {
    number: response.data.number,
    web_url: response.data.html_url,
  };
}

