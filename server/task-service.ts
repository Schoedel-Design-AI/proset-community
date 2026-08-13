import { type TaskProvider } from "@shared/schema";
import { storage } from "./storage";
import { resolveUserOAuthToken, getConnectorMapping } from "./connector-service";

export type PublicTaskProvider = Pick<TaskProvider, "id" | "provider" | "label" | "enabled" | "createdAt">;

export function toPublicTaskProvider(provider: TaskProvider): PublicTaskProvider {
  return {
    id: provider.id,
    provider: provider.provider,
    label: provider.label,
    enabled: provider.enabled,
    createdAt: provider.createdAt,
  };
}

export type TaskProviderType = "google_tasks" | "microsoft_todo" | "todoist" | "custom_api" | "asana" | "jira" | "linear" | "monday" | "github_issues";

export interface ParsedTask {
  title: string;
  completed: boolean;
  notes?: string;
  category?: string;
}

export function parseTodoMarkdown(content: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  const lines = content.split("\n");
  let currentCategory = "";

  for (const line of lines) {
    const trimmed = line.trim();

    const headerMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (headerMatch) {
      currentCategory = headerMatch[1].trim();
      continue;
    }

    const boldHeaderMatch = trimmed.match(/^\*\*(.+?)\*\*\s*:?\s*$/);
    if (boldHeaderMatch && !trimmed.startsWith("- [")) {
      currentCategory = boldHeaderMatch[1].trim();
      continue;
    }

    const checkboxMatch = trimmed.match(/^[-*]\s*\[([ xX])\]\s+(.+)$/);
    if (checkboxMatch) {
      const completed = checkboxMatch[1].toLowerCase() === "x";
      const title = checkboxMatch[2].replace(/\*\*/g, "").trim();
      tasks.push({
        title,
        completed,
        category: currentCategory || undefined,
      });
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch && !trimmed.includes("[ ]") && !trimmed.includes("[x]") && !trimmed.includes("[X]")) {
      const title = bulletMatch[1].replace(/\*\*/g, "").trim();
      if (title.length > 2 && title.length < 300) {
        tasks.push({
          title,
          completed: false,
          category: currentCategory || undefined,
        });
      }
      continue;
    }

    const numberedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      const title = numberedMatch[1].replace(/\*\*/g, "").trim();
      if (title.length > 2 && title.length < 300) {
        tasks.push({
          title,
          completed: false,
          category: currentCategory || undefined,
        });
      }
    }
  }

  return tasks;
}

async function exportToGoogleTasks(
  tasks: ParsedTask[],
  config: { accessToken: string; taskListId?: string }
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    let listId = config.taskListId;
    if (!listId) {
      const listsRes = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!listsRes.ok) throw new Error(`Google Tasks API error: ${listsRes.status}`);
      const listsData = await listsRes.json();
      listId = listsData.items?.[0]?.id;
      if (!listId) throw new Error("No task lists found in Google Tasks");
    }

    let count = 0;
    for (const task of tasks) {
      const body: any = {
        title: task.title,
        status: task.completed ? "completed" : "needsAction",
      };
      if (task.notes) body.notes = task.notes;

      const res = await fetch(
        `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );
      if (res.ok) count++;
    }

    return { success: true, count };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message };
  }
}

async function exportToMicrosoftTodo(
  tasks: ParsedTask[],
  config: { accessToken: string; taskListId?: string }
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    let listId = config.taskListId;
    if (!listId) {
      const listsRes = await fetch("https://graph.microsoft.com/v1.0/me/todo/lists", {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!listsRes.ok) throw new Error(`Microsoft Graph API error: ${listsRes.status}`);
      const listsData = await listsRes.json();
      listId = listsData.value?.[0]?.id;
      if (!listId) throw new Error("No task lists found in Microsoft To Do");
    }

    let count = 0;
    for (const task of tasks) {
      const body: any = {
        title: task.title,
        status: task.completed ? "completed" : "notStarted",
      };
      if (task.category) {
        body.categories = [task.category];
      }

      const res = await fetch(
        `https://graph.microsoft.com/v1.0/me/todo/lists/${listId}/tasks`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );
      if (res.ok) count++;
    }

    return { success: true, count };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message };
  }
}

async function exportToTodoist(
  tasks: ParsedTask[],
  config: { apiToken: string; projectId?: string }
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    let count = 0;
    for (const task of tasks) {
      const body: any = {
        content: task.title,
      };
      if (config.projectId) body.project_id = config.projectId;
      if (task.category) body.section_id = undefined;

      const res = await fetch("https://api.todoist.com/rest/v2/tasks", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        count++;
        if (task.completed) {
          const created = await res.json();
          await fetch(`https://api.todoist.com/rest/v2/tasks/${created.id}/close`, {
            method: "POST",
            headers: { Authorization: `Bearer ${config.apiToken}` },
          });
        }
      }
    }

    return { success: true, count };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message };
  }
}

async function exportToCustomApi(
  tasks: ParsedTask[],
  config: { apiUrl: string; apiKey?: string; headers?: Record<string, string>; method?: string }
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(config.headers || {}),
    };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const method = config.method || "POST";

    const res = await fetch(config.apiUrl, {
      method,
      headers,
      body: JSON.stringify({ tasks }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Custom API error ${res.status}: ${text.substring(0, 200)}`);
    }

    return { success: true, count: tasks.length };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message };
  }
}

async function exportToAsana(
  tasks: ParsedTask[],
  config: { accessToken: string; projectId?: string; workspaceId?: string }
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    let workspaceId = config.workspaceId;
    if (!workspaceId) {
      const wsRes = await fetch("https://app.asana.com/api/1.0/workspaces", {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!wsRes.ok) throw new Error(`Asana API error: ${wsRes.status}`);
      const wsData = await wsRes.json();
      workspaceId = wsData.data?.[0]?.gid;
      if (!workspaceId) throw new Error("No Asana workspaces found");
    }

    let count = 0;
    for (const task of tasks) {
      const body: any = {
        data: {
          name: task.title,
          workspace: workspaceId,
          completed: task.completed,
        },
      };
      if (config.projectId) {
        body.data.projects = [config.projectId];
      }
      if (task.notes) body.data.notes = task.notes;
      if (task.category) body.data.tags = [];

      const res = await fetch("https://app.asana.com/api/1.0/tasks", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (res.ok) count++;
    }

    return { success: true, count };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message };
  }
}

async function exportToJira(
  tasks: ParsedTask[],
  config: { accessToken: string; domain: string; projectKey: string; issueType?: string }
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const issueType = config.issueType || "Task";
    let count = 0;

    for (const task of tasks) {
      const body = {
        fields: {
          project: { key: config.projectKey },
          summary: task.title,
          issuetype: { name: issueType },
          ...(task.notes ? { description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: task.notes }] }] } } : {}),
        },
      };

      const res = await fetch(`https://${config.domain}/rest/api/3/issue`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (res.ok) count++;
    }

    return { success: true, count };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message };
  }
}

async function exportToLinear(
  tasks: ParsedTask[],
  config: { apiKey: string; teamId?: string }
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    let teamId = config.teamId;
    if (!teamId) {
      const teamsRes = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "{ teams { nodes { id name } } }" }),
      });
      if (!teamsRes.ok) throw new Error(`Linear API error: ${teamsRes.status}`);
      const teamsData = await teamsRes.json();
      teamId = teamsData.data?.teams?.nodes?.[0]?.id;
      if (!teamId) throw new Error("No Linear teams found");
    }

    let count = 0;
    for (const task of tasks) {
      const mutation = `
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
          }
        }
      `;

      const res = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: mutation,
          variables: {
            input: {
              teamId,
              title: task.title,
              description: task.notes || undefined,
            },
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.data?.issueCreate?.success) count++;
      }
    }

    return { success: true, count };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message };
  }
}

async function exportToMonday(
  tasks: ParsedTask[],
  config: { apiToken: string; boardId: string }
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    let count = 0;
    for (const task of tasks) {
      const mutation = `mutation { create_item (board_id: ${config.boardId}, item_name: "${task.title.replace(/"/g, '\\"')}") { id } }`;

      const res = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
          Authorization: config.apiToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: mutation }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.data?.create_item?.id) count++;
      }
    }

    return { success: true, count };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message };
  }
}

async function exportToGitHubIssues(
  tasks: ParsedTask[],
  config: { accessToken: string; owner: string; repo: string; labels?: string[] }
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    let count = 0;
    for (const task of tasks) {
      const body: any = {
        title: task.title,
      };
      if (task.notes) body.body = task.notes;
      if (task.category) {
        body.labels = [task.category, ...(config.labels || [])];
      } else if (config.labels?.length) {
        body.labels = config.labels;
      }

      const res = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify(body),
      });
      if (res.ok) count++;
    }

    return { success: true, count };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message };
  }
}

async function resolveOAuthConfig(
  providerType: TaskProviderType,
  config: Record<string, any>,
  userId: string
): Promise<Record<string, any>> {
  if (config.useOAuth && getConnectorMapping(providerType)) {
    try {
      const { token, configKey } = await resolveUserOAuthToken(userId, providerType);
      return { ...config, [configKey]: token };
    } catch (err: any) {
      throw new Error(`Connector error: ${err.message}`);
    }
  }
  return config;
}

export async function exportTasks(
  providerType: TaskProviderType,
  tasks: ParsedTask[],
  config: Record<string, any>,
  userId: string
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const resolvedConfig = await resolveOAuthConfig(providerType, config, userId);

    switch (providerType) {
      case "google_tasks":
        return exportToGoogleTasks(tasks, resolvedConfig as any);
      case "microsoft_todo":
        return exportToMicrosoftTodo(tasks, resolvedConfig as any);
      case "todoist":
        return exportToTodoist(tasks, resolvedConfig as any);
      case "custom_api":
        return exportToCustomApi(tasks, resolvedConfig as any);
      case "asana":
        return exportToAsana(tasks, resolvedConfig as any);
      case "jira":
        return exportToJira(tasks, resolvedConfig as any);
      case "linear":
        return exportToLinear(tasks, resolvedConfig as any);
      case "monday":
        return exportToMonday(tasks, resolvedConfig as any);
      case "github_issues":
        return exportToGitHubIssues(tasks, resolvedConfig as any);
      default:
        return { success: false, count: 0, error: `Unknown provider: ${providerType}` };
    }
  } catch (err: any) {
    return { success: false, count: 0, error: err.message };
  }
}

export async function getAllTaskProviders(userId: string): Promise<TaskProvider[]> {
  const providers = await storage.taskProviders.getByUser(userId);
  return providers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function addTaskProvider(
  userId: string,
  provider: TaskProviderType,
  label: string,
  config: Record<string, any>
): Promise<TaskProvider> {
  const providerData: TaskProvider = {
    id: Math.random().toString(36).substring(2, 15),
    userId,
    provider,
    label,
    enabled: 1,
    config,
    createdAt: new Date().toISOString()
  };
  return await storage.taskProviders.create(providerData);
}

export async function updateTaskProvider(
  userId: string,
  providerId: string,
  updates: { enabled?: number; label?: string; config?: Record<string, any> }
): Promise<TaskProvider | null> {
  const existing = await storage.taskProviders.get(providerId);
  if (!existing || existing.userId !== userId) return null;

  const updateFields: any = {};
  if (updates.enabled !== undefined) updateFields.enabled = updates.enabled;
  if (updates.label !== undefined) updateFields.label = updates.label;
  if (updates.config !== undefined) updateFields.config = updates.config;

  return await storage.taskProviders.update(providerId, updateFields);
}

export async function removeTaskProvider(userId: string, providerId: string): Promise<boolean> {
  const existing = await storage.taskProviders.get(providerId);
  if (!existing || existing.userId !== userId) return false;

  return await storage.taskProviders.delete(providerId);
}

export async function testTaskProvider(
  providerType: TaskProviderType,
  config: Record<string, any>,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const resolvedConfig = await resolveOAuthConfig(providerType, config, userId);
    const cfg = resolvedConfig as any;
    switch (providerType) {
      case "google_tasks": {
        const res = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
          headers: { Authorization: `Bearer ${cfg.accessToken}` },
        });
        if (!res.ok) throw new Error(`Google Tasks API returned ${res.status}`);
        return { success: true };
      }
      case "microsoft_todo": {
        const res = await fetch("https://graph.microsoft.com/v1.0/me/todo/lists", {
          headers: { Authorization: `Bearer ${cfg.accessToken}` },
        });
        if (!res.ok) throw new Error(`Microsoft Graph API returned ${res.status}`);
        return { success: true };
      }
      case "todoist": {
        const res = await fetch("https://api.todoist.com/rest/v2/projects", {
          headers: { Authorization: `Bearer ${cfg.apiToken}` },
        });
        if (!res.ok) throw new Error(`Todoist API returned ${res.status}`);
        return { success: true };
      }
      case "asana": {
        const res = await fetch("https://app.asana.com/api/1.0/users/me", {
          headers: { Authorization: `Bearer ${cfg.accessToken}` },
        });
        if (!res.ok) throw new Error(`Asana API returned ${res.status}`);
        return { success: true };
      }
      case "jira": {
        const res = await fetch(`https://${cfg.domain}/rest/api/3/myself`, {
          headers: { Authorization: `Bearer ${cfg.accessToken}` },
        });
        if (!res.ok) throw new Error(`Jira API returned ${res.status}`);
        return { success: true };
      }
      case "linear": {
        const res = await fetch("https://api.linear.app/graphql", {
          method: "POST",
          headers: { Authorization: cfg.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ query: "{ viewer { id } }" }),
        });
        if (!res.ok) throw new Error(`Linear API returned ${res.status}`);
        return { success: true };
      }
      case "monday": {
        const res = await fetch("https://api.monday.com/v2", {
          method: "POST",
          headers: { Authorization: cfg.apiToken, "Content-Type": "application/json" },
          body: JSON.stringify({ query: "{ me { id } }" }),
        });
        if (!res.ok) throw new Error(`Monday.com API returned ${res.status}`);
        return { success: true };
      }
      case "github_issues": {
        const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, {
          headers: { Authorization: `Bearer ${cfg.accessToken}`, Accept: "application/vnd.github.v3+json" },
        });
        if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
        return { success: true };
      }
      case "custom_api": {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...(config.headers || {}),
        };
        if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;
        const res = await fetch(config.apiUrl, {
          method: "HEAD",
          headers,
        });
        return { success: true };
      }
      default:
        return { success: false, error: "Unknown provider type" };
    }
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
