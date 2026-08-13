import { type ConnectorProvider } from "@shared/schema";
import { storage } from "./storage";

export type PublicConnectorProvider = Pick<ConnectorProvider, "id" | "provider" | "label" | "enabled" | "createdAt">;

export function toPublicConnectorProvider(provider: ConnectorProvider): PublicConnectorProvider {
  return {
    id: provider.id,
    provider: provider.provider,
    label: provider.label,
    enabled: provider.enabled,
    createdAt: provider.createdAt,
  };
}

export type ConnectorType =
  | "box" | "sharepoint" | "dropbox"
  | "github_gist" | "discord" | "hubspot" | "elevenlabs"
  | "google_calendar" | "todoist" | "github" | "linear" | "asana";

export interface ConnectorExportResult {
  success: boolean;
  error?: string;
  url?: string;
  data?: any;
}

export async function getUserConnectorProviders(userId: string) {
  const providers = await storage.connectorProviders.getByUser(userId);
  providers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return providers;
}

export async function addConnectorProvider(
  userId: string,
  provider: string,
  label: string,
  config: Record<string, any>
) {
  const providers = await storage.connectorProviders.getByUser(userId);
  const existing = providers.find(cp => cp.provider === provider);

  if (existing) {
    return await storage.connectorProviders.update(existing.id, { label, config, enabled: 1 });
  }

  return await storage.connectorProviders.create({
    id: "",
    userId,
    provider,
    label,
    config,
    enabled: 1,
    createdAt: new Date().toISOString()
  });
}

export async function updateConnectorProvider(
  userId: string,
  providerId: string,
  updates: { label?: string; config?: Record<string, any>; enabled?: number }
) {
  const existing = await storage.connectorProviders.get(providerId);
  if (!existing || existing.userId !== userId) return null;

  return await storage.connectorProviders.update(providerId, updates);
}

export async function removeConnectorProvider(userId: string, providerId: string) {
  const existing = await storage.connectorProviders.get(providerId);
  if (!existing || existing.userId !== userId) return false;

  return await storage.connectorProviders.delete(providerId);
}

export async function getUserConnectorConfig(userId: string, provider: string): Promise<Record<string, any> | null> {
  const providers = await storage.connectorProviders.getByUser(userId);
  const row = providers.find(cp => cp.provider === provider && cp.enabled === 1);
  return row ? (row.config as Record<string, any>) : null;
}

export const CONNECTOR_CONVERSION_MAP: Partial<Record<ConnectorType, string[]>> = {
  box: ["all"],
  sharepoint: ["all"],
  dropbox: ["all"],
  github_gist: ["all"],
  discord: ["all"],
  hubspot: ["email", "blog_post", "linkedin_post", "summary", "bullet_points"],
  elevenlabs: [
    "summary", "blog_post", "email", "linkedin_post", "podcast_script",
    "text_message", "parish_bulletin", "quick_research", "spiritual_reflection",
    "prayer", "catechesis_lesson", "pastoral_plan", "notes", "outline",
    "bullet_points", "action_items", "todo_list", "questions", "requirements",
    "prompt", "project_plan", "lesson_plan", "nonfiction_draft", "argumentative_essay",
  ],
};

export function isConnectorRelevant(connector: ConnectorType, conversionType: string): boolean {
  const types = CONNECTOR_CONVERSION_MAP[connector];
  if (!types) return false;
  return types.includes("all") || types.includes(conversionType);
}

function getAvailableConnectors(): { type: ConnectorType; label: string; icon: string; available: boolean; category: string }[] {
  return [
    { type: "box", label: "Box", icon: "box", available: !!process.env.BOX_ACCESS_TOKEN, category: "storage" },
    { type: "sharepoint", label: "SharePoint", icon: "hard-drive", available: !!process.env.SHAREPOINT_ACCESS_TOKEN, category: "storage" },
    { type: "dropbox", label: "Dropbox", icon: "inbox", available: !!process.env.DROPBOX_ACCESS_TOKEN, category: "storage" },
    { type: "github_gist", label: "GitHub Gist", icon: "github", available: !!process.env.GITHUB_ACCESS_TOKEN, category: "developer" },
    { type: "discord", label: "Discord", icon: "message-circle", available: !!process.env.DISCORD_BOT_TOKEN, category: "communication" },
    { type: "hubspot", label: "HubSpot", icon: "briefcase", available: !!process.env.HUBSPOT_ACCESS_TOKEN, category: "crm" },
    { type: "elevenlabs", label: "ElevenLabs TTS", icon: "volume-2", available: !!process.env.ELEVENLABS_API_KEY, category: "audio" },
    { type: "google_calendar", label: "Google Calendar", icon: "calendar", available: false, category: "productivity" },
    { type: "todoist", label: "Todoist", icon: "check-square", available: false, category: "productivity" },
    { type: "github", label: "GitHub", icon: "github", available: false, category: "developer" },
    { type: "linear", label: "Linear", icon: "zap", available: false, category: "developer" },
    { type: "asana", label: "Asana", icon: "list", available: false, category: "productivity" },
  ];
}

const PER_USER_CONNECTOR_TYPES = ["elevenlabs", "google_calendar", "todoist", "github", "linear", "asana"] as const;

export type OAuthConnectorProvider = "google_calendar" | "todoist" | "github" | "linear" | "asana";

interface ConnectorMapping {
  connector: OAuthConnectorProvider;
  configKey: string;
}

const PROVIDER_TO_CONNECTOR: Record<string, ConnectorMapping> = {
  google_tasks: { connector: "google_calendar", configKey: "accessToken" },
  google_calendar: { connector: "google_calendar", configKey: "accessToken" },
  google_drive: { connector: "google_calendar", configKey: "accessToken" },
  todoist: { connector: "todoist", configKey: "apiToken" },
  github_issues: { connector: "github", configKey: "accessToken" },
  linear: { connector: "linear", configKey: "apiKey" },
  asana: { connector: "asana", configKey: "accessToken" },
};

const OAUTH_PROVIDER_MAP: Record<string, string[]> = {
  google_calendar: ["google_tasks", "google_calendar", "google_drive"],
  todoist: ["todoist"],
  github: ["github_issues"],
  linear: ["linear"],
  asana: ["asana"],
};

export function getConnectorMapping(providerType: string): ConnectorMapping | null {
  return PROVIDER_TO_CONNECTOR[providerType] ?? null;
}

export async function resolveUserOAuthToken(
  userId: string,
  providerType: string
): Promise<{ token: string; configKey: string }> {
  const mapping = PROVIDER_TO_CONNECTOR[providerType];
  if (!mapping) {
    throw new Error(`No connector mapping for provider: ${providerType}`);
  }

  const config = await getUserConnectorConfig(userId, mapping.connector);
  if (!config || !config.accessToken) {
    throw new Error(
      `${mapping.connector.replace(/_/g, " ")} not connected. Please add your access token in Settings → Connectors.`
    );
  }

  return { token: config.accessToken as string, configKey: mapping.configKey };
}

export async function getAvailableOAuthProvidersForUser(userId: string): Promise<string[]> {
  const userConnectors = await getUserConnectorProviders(userId);
  const available = new Set<string>();
  for (const connector of userConnectors) {
    const connConfig = connector.config as Record<string, unknown> | null;
    if (connector.enabled && connConfig && typeof connConfig === "object" && "accessToken" in connConfig && connConfig.accessToken) {
      const mappedProviders = OAUTH_PROVIDER_MAP[connector.provider];
      if (mappedProviders) {
        mappedProviders.forEach(p => available.add(p));
      }
    }
  }
  return Array.from(available);
}

export async function getAvailableConnectorsForUser(userId: string): Promise<{ type: ConnectorType; label: string; icon: string; available: boolean; category: string }[]> {
  const connectors = getAvailableConnectors();
  const userConfigs = await Promise.all(
    PER_USER_CONNECTOR_TYPES.map(async (type) => {
      const config = await getUserConnectorConfig(userId, type);
      return [type, config] as const;
    })
  );
  const configMap = Object.fromEntries(userConfigs);

  return connectors.map(c => {
    const cfg = configMap[c.type];
    if (c.type === "elevenlabs") {
      const hasUserKey = !!(cfg && typeof cfg === "object" && "apiKey" in cfg && cfg.apiKey);
      return { ...c, available: c.available || hasUserKey };
    }
    if (["google_calendar", "todoist", "github", "linear", "asana"].includes(c.type)) {
      const hasToken = !!(cfg && typeof cfg === "object" && "accessToken" in cfg && cfg.accessToken);
      return { ...c, available: hasToken };
    }
    return c;
  });
}

export async function getRelevantConnectorsForUser(userId: string, conversionType: string): Promise<{ type: ConnectorType; label: string; icon: string; category: string }[]> {
  const connectors = await getAvailableConnectorsForUser(userId);
  return connectors
    .filter(c => c.available && isConnectorRelevant(c.type, conversionType))
    .map(({ type, label, icon, category }) => ({ type, label, icon, category }));
}

async function exportToBox(
  content: string,
  title: string,
  config: { accessToken?: string; folderId?: string }
): Promise<ConnectorExportResult> {
  try {
    const token = config.accessToken || process.env.BOX_ACCESS_TOKEN;
    if (!token) return { success: false, error: "Box not connected" };

    const folderId = config.folderId || "0";
    const fileName = `${title.replace(/[^a-zA-Z0-9\s\-_]/g, "").replace(/\s+/g, "_")}.md`;

    const attributes = JSON.stringify({
      name: fileName,
      parent: { id: folderId },
    });

    const boundary = "----BoxFormBoundary" + Date.now();
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="attributes"',
      "",
      attributes,
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
      "Content-Type: text/markdown",
      "",
      content,
      `--${boundary}--`,
    ].join("\r\n");

    const res = await fetch("https://upload.box.com/api/2.0/files/content", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Box API error ${res.status}: ${text.substring(0, 200)}`);
    }

    const data = await res.json();
    return { success: true, url: data.entries?.[0]?.shared_link?.url };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function exportToSharePoint(
  content: string,
  title: string,
  config: { accessToken?: string; siteId?: string; driveId?: string; folderPath?: string }
): Promise<ConnectorExportResult> {
  try {
    const token = config.accessToken || process.env.SHAREPOINT_ACCESS_TOKEN;
    if (!token) return { success: false, error: "SharePoint not connected" };

    const fileName = `${title.replace(/[^a-zA-Z0-9\s\-_]/g, "").replace(/\s+/g, "_")}.md`;
    const folderPath = config.folderPath || "/noted-ai";

    let uploadUrl: string;
    if (config.driveId) {
      uploadUrl = `https://graph.microsoft.com/v1.0/drives/${config.driveId}/root:${folderPath}/${fileName}:/content`;
    } else if (config.siteId) {
      uploadUrl = `https://graph.microsoft.com/v1.0/sites/${config.siteId}/drive/root:${folderPath}/${fileName}:/content`;
    } else {
      uploadUrl = `https://graph.microsoft.com/v1.0/me/drive/root:${folderPath}/${fileName}:/content`;
    }

    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/markdown",
      },
      body: content,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SharePoint API error ${res.status}: ${text.substring(0, 200)}`);
    }

    const data = await res.json();
    return { success: true, url: data.webUrl };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function exportToDropbox(
  content: string,
  title: string,
  config: { accessToken?: string; folderPath?: string }
): Promise<ConnectorExportResult> {
  try {
    const token = config.accessToken || process.env.DROPBOX_ACCESS_TOKEN;
    if (!token) return { success: false, error: "Dropbox not connected" };

    const fileName = `${title.replace(/[^a-zA-Z0-9\s\-_]/g, "").replace(/\s+/g, "_")}.md`;
    const folderPath = config.folderPath || "/noted-ai";

    const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path: `${folderPath}/${fileName}`,
          mode: "add",
          autorename: true,
          mute: false,
        }),
      },
      body: content,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dropbox API error ${res.status}: ${text.substring(0, 200)}`);
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function exportToGitHubGist(
  content: string,
  title: string,
  conversionType: string,
  config: { accessToken?: string; isPublic?: boolean }
): Promise<ConnectorExportResult> {
  try {
    const token = config.accessToken || process.env.GITHUB_ACCESS_TOKEN;
    if (!token) return { success: false, error: "GitHub not connected" };

    const extMap: Record<string, string> = {
      python_script: "py",
      linux_commands: "sh",
      spreadsheet: "csv",
      email: "md",
      blog_post: "md",
      summary: "md",
      bullet_points: "md",
      plan: "md",
      todo_list: "md",
      requirements: "md",
      questions: "md",
      linkedin_post: "md",
      prompt: "md",
      quick_research: "md",
      academic_research: "md",
      calendar_event: "md",
    };

    const ext = extMap[conversionType] || "md";
    const fileName = `${title.replace(/[^a-zA-Z0-9\s\-_]/g, "").replace(/\s+/g, "_")}.${ext}`;

    const res = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({
        description: `Proset - ${title}`,
        public: config.isPublic ?? false,
        files: { [fileName]: { content } },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API error ${res.status}: ${text.substring(0, 200)}`);
    }

    const data = await res.json();
    return { success: true, url: data.html_url };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function exportToDiscord(
  content: string,
  title: string,
  config: { botToken?: string; webhookUrl?: string; channelId?: string }
): Promise<ConnectorExportResult> {
  try {
    const truncated = content.length > 1900
      ? content.substring(0, 1900) + "\n\n... (truncated)"
      : content;

    if (config.webhookUrl) {
      const res = await fetch(config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `**${title}**\n\n${truncated}`,
        }),
      });
      if (!res.ok) throw new Error(`Discord webhook error ${res.status}`);
      return { success: true };
    }

    const token = config.botToken || process.env.DISCORD_BOT_TOKEN;
    if (!token || !config.channelId) {
      return { success: false, error: "Discord not configured. Provide a webhook URL or bot token + channel ID." };
    }

    const res = await fetch(`https://discord.com/api/v10/channels/${config.channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: `**${title}**\n\n${truncated}`,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Discord API error ${res.status}: ${text.substring(0, 200)}`);
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function exportToHubSpot(
  content: string,
  title: string,
  conversionType: string,
  config: { accessToken?: string; contactEmail?: string }
): Promise<ConnectorExportResult> {
  try {
    const token = config.accessToken || process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) return { success: false, error: "HubSpot not connected" };

    const res = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          hs_note_body: `<h3>${title}</h3><br>${content.replace(/\n/g, "<br>")}`,
          hs_timestamp: new Date().toISOString(),
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HubSpot API error ${res.status}: ${text.substring(0, 200)}`);
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

const TTS_ABBREVIATIONS: [RegExp, string][] = [
  [/\be\.g\.\s*/gi, "for example "],
  [/\bi\.e\.\s*/gi, "that is "],
  [/\betc\.\s*/gi, "etcetera "],
  [/\bvs\.\s*/gi, "versus "],
  [/\bDr\.\s*/gi, "Doctor "],
  [/\bMr\.\s*/gi, "Mister "],
  [/\bMrs\.\s*/gi, "Missus "],
  [/\bMs\.\s*/gi, "Ms "],
  [/\bSt\.\s*/gi, "Saint "],
  [/\bw\/\s*/gi, "with "],
  [/\bw\/o\s*/gi, "without "],
  [/\bapprox\.\s*/gi, "approximately "],
  [/\bmin\.\s*/gi, "minutes "],
  [/\bhr\.\s*/gi, "hour "],
  [/\bhrs\.\s*/gi, "hours "],
  [/\bft\.\s*/gi, "feet "],
  [/\bAPI\b/g, "A P I"],
  [/\bURL\b/g, "U R L"],
  [/\bHTML\b/g, "H T M L"],
  [/\bCSS\b/g, "C S S"],
  [/\bSQL\b/g, "S Q L"],
  [/\bJSON\b/g, "J S O N"],
  [/\bTTS\b/g, "text to speech"],
  [/\bAI\b/g, "A I"],
];

export function prepareTtsText(content: string): string {
  let text = content;
  text = text.replace(/```[\s\S]*?```/g, "");
  text = text.replace(/`[^`]+`/g, (m) => m.slice(1, -1));
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, "$1");
  text = text.replace(/\*\*(.+?)\*\*/g, "$1");
  text = text.replace(/__(.+?)__/g, "$1");
  text = text.replace(/\*(.+?)\*/g, "$1");
  text = text.replace(/_(.+?)_/g, "$1");
  text = text.replace(/~~(.+?)~~/g, "$1");
  text = text.replace(/^[-*+]\s+\[[ xX]\]\s*/gm, "");
  text = text.replace(/^[-*+]\s+/gm, "");
  text = text.replace(/^\d+\.\s+/gm, "");
  text = text.replace(/^>\s*/gm, "");
  text = text.replace(/^---+$/gm, "");
  text = text.replace(/^===+$/gm, "");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/https?:\/\/[^\s)]+/g, "");
  text = text.replace(/\|/g, ",");
  text = text.replace(/^[-:| ]+$/gm, "");
  for (const [pattern, replacement] of TTS_ABBREVIATIONS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/^ +| +$/gm, "");
  text = text.trim();
  return text;
}

async function exportToElevenLabs(
  content: string,
  config: { apiKey?: string; voiceId?: string; modelId?: string }
): Promise<ConnectorExportResult> {
  try {
    const apiKey = config.apiKey || process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return { success: false, error: "ElevenLabs API key not configured." };

    const voiceId = config.voiceId || "21m00Tcm4TlvDq8ikWAM";
    const modelId = config.modelId || "eleven_multilingual_v2";

    const textForTts = prepareTtsText(content).substring(0, 5000);

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: textForTts,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ElevenLabs API error ${res.status}: ${text.substring(0, 200)}`);
    }

    const audioBuffer = await res.arrayBuffer();
    const base64 = Buffer.from(audioBuffer).toString("base64");
    return {
      success: true,
      data: {
        audio: base64,
        mimeType: "audio/mpeg",
        format: "mp3",
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function exportToConnector(
  connectorType: ConnectorType,
  content: string,
  title: string,
  conversionType: string,
  config: Record<string, any> = {}
): Promise<ConnectorExportResult> {
  switch (connectorType) {
    case "box":
      return exportToBox(content, title, config);
    case "sharepoint":
      return exportToSharePoint(content, title, config);
    case "dropbox":
      return exportToDropbox(content, title, config);
    case "github_gist":
      return exportToGitHubGist(content, title, conversionType, config);
    case "discord":
      return exportToDiscord(content, title, config);
    case "hubspot":
      return exportToHubSpot(content, title, conversionType, config);
    case "elevenlabs":
      return exportToElevenLabs(content, config);
    default:
      return { success: false, error: `Unknown connector: ${connectorType}` };
  }
}
