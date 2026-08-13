import { Octokit } from "@octokit/rest";

type FeedbackWorkItemOptions = {
  category: string;
  message: string;
  userEmail?: string;
  userName?: string;
  userNumber?: string;
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
  const repo = (process.env.GITHUB_REPO || "schoedel-learn/barry-ai")?.trim();

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
  ].filter(Boolean);

  return [
    "## Proset Feedback Submission",
    "",
    `Category: ${opts.category}`,
    ...userLines,
    "",
    "## Message",
    "",
    opts.message.trim(),
  ].join("\n");
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
    labels: ["feedback", opts.category.toLowerCase()].filter(Boolean) as string[],
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

