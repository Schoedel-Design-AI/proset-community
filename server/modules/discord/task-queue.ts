import { CloudTasksClient, protos } from "@google-cloud/tasks";
import { OAuth2Client } from "google-auth-library";

const oauthClient = new OAuth2Client();

function taskConfig() {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
  const location = process.env.CLOUD_TASKS_LOCATION || "us-central1";
  const queue = process.env.DISCORD_TASK_QUEUE;
  const serviceAccountEmail = process.env.DISCORD_TASK_SERVICE_ACCOUNT;
  const baseUrl = (process.env.DISCORD_TASK_BASE_URL || "").replace(/\/+$/, "");
  return {
    project,
    location,
    queue,
    serviceAccountEmail,
    url: baseUrl ? `${baseUrl}/api/discord/internal/jobs` : "",
    audience: process.env.DISCORD_TASK_AUDIENCE || baseUrl,
  };
}

export function hasDiscordTaskQueue(): boolean {
  const config = taskConfig();
  return Boolean(config.project && config.queue && config.serviceAccountEmail && config.url && config.audience);
}

export async function enqueueDiscordJob(jobId: string, deliveryAttempt = 0): Promise<boolean> {
  const config = taskConfig();
  if (!hasDiscordTaskQueue()) return false;
  const client = new CloudTasksClient();
  const parent = client.queuePath(config.project!, config.location, config.queue!);
  const taskSuffix = `${jobId}-${deliveryAttempt}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const name = client.taskPath(config.project!, config.location, config.queue!, taskSuffix);
  try {
    await client.createTask({
      parent,
      task: {
        name,
        dispatchDeadline: { seconds: 1800 },
        httpRequest: {
          httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
          url: config.url,
          headers: { "Content-Type": "application/json" },
          oidcToken: {
            serviceAccountEmail: config.serviceAccountEmail,
            audience: config.audience,
          },
          body: Buffer.from(JSON.stringify({ jobId })).toString("base64"),
        },
      },
    });
    return true;
  } catch (error: any) {
    if (error?.code === 6 || String(error?.message || "").includes("ALREADY_EXISTS")) return true;
    throw error;
  }
}

export async function verifyDiscordTaskAuthorization(
  authorizationHeader: string | undefined,
  taskNameHeader?: string | string[],
  queueNameHeader?: string | string[],
): Promise<boolean> {
  const config = taskConfig();
  if (process.env.DISCORD_TASK_TRUST_CLOUD_RUN_IAM === "true") {
    const taskName = Array.isArray(taskNameHeader) ? taskNameHeader[0] : taskNameHeader;
    const queueName = Array.isArray(queueNameHeader) ? queueNameHeader[0] : queueNameHeader;
    return Boolean(config.queue && taskName?.trim() && queueName === config.queue);
  }
  if (!hasDiscordTaskQueue() || !authorizationHeader?.startsWith("Bearer ")) return false;
  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken: authorizationHeader.slice("Bearer ".length),
      audience: config.audience,
    });
    const payload = ticket.getPayload();
    return payload?.email_verified === true && payload.email === config.serviceAccountEmail;
  } catch {
    return false;
  }
}
