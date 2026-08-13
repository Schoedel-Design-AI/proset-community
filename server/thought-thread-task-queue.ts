import { CloudTasksClient, protos } from "@google-cloud/tasks";
import { OAuth2Client } from "google-auth-library";

const oauthClient = new OAuth2Client();

function taskConfig() {
  const project =
    process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || process.env.FIREBASE_PROJECT_ID;
  const location = process.env.CLOUD_TASKS_LOCATION || "us-central1";
  const queue = process.env.THOUGHT_THREAD_TASK_QUEUE;
  const serviceAccountEmail = process.env.THOUGHT_THREAD_TASK_SERVICE_ACCOUNT;
  // Deployed environments use the service's canonical run.app URL here. Cloud
  // Run validates the task's OIDC audience before the request reaches this
  // application; custom-domain audiences are rejected at that boundary.
  const baseUrl = (
    process.env.THOUGHT_THREAD_TASK_BASE_URL
    || process.env.PUBLIC_APP_URL
    || ""
  ).replace(/\/+$/, "");
  const url = baseUrl
    ? `${baseUrl}/api/internal/thought-thread-preparation`
    : "";
  const audience = process.env.THOUGHT_THREAD_TASK_AUDIENCE || baseUrl;
  return { project, location, queue, serviceAccountEmail, url, audience };
}

export function hasThoughtThreadTaskQueue(): boolean {
  const config = taskConfig();
  return Boolean(
    config.project
    && config.queue
    && config.serviceAccountEmail
    && config.url
    && config.audience,
  );
}

export async function enqueueThoughtThreadPreparation(input: {
  runId: string;
  threadId: string;
  userId: string;
  attempt?: number;
}): Promise<boolean> {
  const config = taskConfig();
  if (!hasThoughtThreadTaskQueue()) return false;
  const client = new CloudTasksClient();
  const parent = client.queuePath(config.project!, config.location, config.queue!);
  const taskName = client.taskPath(
    config.project!,
    config.location,
    config.queue!,
    `${input.runId}-${input.attempt || 0}`.replace(/[^a-zA-Z0-9_-]/g, "_"),
  );
  const task = {
    name: taskName,
    dispatchDeadline: { seconds: 1800 },
    httpRequest: {
      httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
      url: config.url,
      headers: { "Content-Type": "application/json" },
      oidcToken: {
        serviceAccountEmail: config.serviceAccountEmail,
        audience: config.audience,
      },
      body: Buffer.from(JSON.stringify(input)).toString("base64"),
    },
  };
  try {
    await client.createTask({ parent, task });
    return true;
  } catch (error: any) {
    // Deterministic task names make enqueue idempotent across lost responses.
    if (error?.code === 6 || String(error?.message || "").includes("ALREADY_EXISTS")) {
      return true;
    }
    throw error;
  }
}

export async function verifyThoughtThreadTaskAuthorization(
  authorizationHeader: string | undefined,
  taskNameHeader?: string | string[],
  queueNameHeader?: string | string[],
): Promise<boolean> {
  const config = taskConfig();
  if (process.env.THOUGHT_THREAD_TASK_TRUST_CLOUD_RUN_IAM === "true") {
    const taskName = Array.isArray(taskNameHeader) ? taskNameHeader[0] : taskNameHeader;
    const queueName = Array.isArray(queueNameHeader) ? queueNameHeader[0] : queueNameHeader;
    return Boolean(
      config.queue
      && taskName?.trim()
      && queueName === config.queue,
    );
  }
  if (!hasThoughtThreadTaskQueue() || !authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }
  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken: authorizationHeader.slice("Bearer ".length),
      audience: config.audience,
    });
    const payload = ticket.getPayload();
    return payload?.email_verified === true
      && payload.email === config.serviceAccountEmail;
  } catch {
    return false;
  }
}
