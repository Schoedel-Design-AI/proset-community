import { Request, Response, Router } from "express";
import { requireAuth } from "./auth";
import { Octokit } from "@octokit/rest";
import { storage } from "./storage";

export const bugReportRouter = Router();

bugReportRouter.post("/report", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    
    // Verify admin role
    const user = await storage.users.get(userId);
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
      return res.status(403).json({ error: "Unauthorized: Only admins can report bugs via this endpoint." });
    }

    const { description, image, url, userAgent, windowSize, timestamp } = req.body;

    if (!description) {
      return res.status(400).json({ error: "Description is required." });
    }

    const githubToken = process.env.GITHUB_TOKEN;
    const githubRepo = process.env.GITHUB_REPO; // Format: "owner/repo"
    const gitlabToken = process.env.GITLAB_TOKEN;
    const gitlabProjectId = process.env.GITLAB_PROJECT_ID;

    // Build the Markdown body
    let markdownBody = `## UI Bug Report\n\n**Reported By:** ${user.email}\n**URL:** ${url}\n**Time:** ${timestamp}\n**Window Size:** ${windowSize}\n**User Agent:** ${userAgent}\n\n### Description\n${description}\n`;

    if (image) {
      // In a real production scenario with S3, we would upload the image to S3 and embed the URL here.
      // Since GitHub issues support base64 images within an HTML img tag, we can try to embed it.
      // Note: Large base64 strings might hit payload limits, but it's okay for simple screenshots.
      markdownBody += `\n### Screenshot\n<details><summary>Click to view screenshot</summary>\n\n<img src="${image}" alt="Bug Screenshot" style="max-width: 100%;" />\n\n</details>`;
    }

    // Try GitHub first
    if (githubToken && githubRepo) {
      const [owner, repo] = githubRepo.split("/");
      const octokit = new Octokit({ auth: githubToken });
      
      const issue = await octokit.rest.issues.create({
        owner,
        repo,
        title: `🐛 UI Bug: ${description.substring(0, 50)}${description.length > 50 ? '...' : ''}`,
        body: markdownBody,
        labels: ["bug", "ui", "admin-reported"]
      });

      return res.json({ success: true, message: "Bug reported to GitHub", issueUrl: issue.data.html_url });
    } 
    // Try GitLab
    else if (gitlabToken && gitlabProjectId) {
      const gitlabUrl = process.env.GITLAB_URL || "https://gitlab.com";
      const resGitlab = await fetch(`${gitlabUrl}/api/v4/projects/${gitlabProjectId}/issues`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "PRIVATE-TOKEN": gitlabToken
        },
        body: JSON.stringify({
          title: `🐛 UI Bug: ${description.substring(0, 50)}${description.length > 50 ? '...' : ''}`,
          description: markdownBody,
          labels: "bug,ui,admin-reported"
        })
      });

      if (!resGitlab.ok) {
        throw new Error("Failed to create GitLab issue.");
      }

      const issue = await resGitlab.json();
      return res.json({ success: true, message: "Bug reported to GitLab", issueUrl: issue.web_url });
    } 
    // Fallback if no Git tokens are configured
    else {
      // We could write to the DB or return a message indicating configuration is needed
      console.warn("No GITHUB_TOKEN or GITLAB_TOKEN configured. Bug report not pushed to Git.");
      return res.json({ 
        success: true, 
        message: "Bug received but no Git provider is configured. Set GITHUB_TOKEN & GITHUB_REPO or GITLAB_TOKEN & GITLAB_PROJECT_ID in your .env.",
        data: { description, url }
      });
    }

  } catch (error: any) {
    console.error("Error submitting bug report:", error);
    res.status(500).json({ error: error.message || "Failed to submit bug report." });
  }
});