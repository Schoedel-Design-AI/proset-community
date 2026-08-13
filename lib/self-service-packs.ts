import type { SelfServiceModuleState } from "@shared/self-service-modules";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type SelfServiceModulesResponse = {
  modules?: unknown;
};

type SelfServiceModuleUpdateResponse = {
  module?: unknown;
};

export class SelfServicePackRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "SelfServicePackRequestError";
  }
}

function isSelfServiceModuleState(value: unknown): value is SelfServiceModuleState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SelfServiceModuleState>;
  return typeof candidate.moduleName === "string"
    && typeof candidate.requiredTier === "string"
    && typeof candidate.eligible === "boolean"
    && typeof candidate.enabled === "boolean"
    && typeof candidate.effectiveEnabled === "boolean"
    && typeof candidate.userCanToggle === "boolean";
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function getResponseError(
  response: Response,
  body: Record<string, unknown>,
): SelfServicePackRequestError {
  const code = typeof body.error === "string" ? body.error : null;
  const message = code || response.statusText || `HTTP ${response.status}`;
  return new SelfServicePackRequestError(message, response.status, code);
}

export async function fetchSelfServicePacks(
  fetcher: FetchLike,
  url: string,
  headers: Record<string, string>,
): Promise<SelfServiceModuleState[]> {
  const response = await fetcher(url, {
    credentials: "include",
    headers,
  });
  const body = await readJson(response) as SelfServiceModulesResponse;
  if (!response.ok) {
    throw getResponseError(response, body as Record<string, unknown>);
  }
  if (!Array.isArray(body.modules) || !body.modules.every(isSelfServiceModuleState)) {
    throw new SelfServicePackRequestError("invalid_module_response", response.status, "invalid_module_response");
  }
  return body.modules;
}

export async function updateSelfServicePack(
  fetcher: FetchLike,
  url: string,
  headers: Record<string, string>,
  enabled: boolean,
): Promise<SelfServiceModuleState> {
  const response = await fetcher(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    credentials: "include",
    body: JSON.stringify({ enabled }),
  });
  const body = await readJson(response) as SelfServiceModuleUpdateResponse;
  if (!response.ok) {
    throw getResponseError(response, body as Record<string, unknown>);
  }
  if (!isSelfServiceModuleState(body.module)) {
    throw new SelfServicePackRequestError("invalid_module_response", response.status, "invalid_module_response");
  }
  return body.module;
}

export function setOptimisticPackState(
  states: SelfServiceModuleState[],
  moduleName: string,
  enabled: boolean,
): SelfServiceModuleState[] {
  return states.map((pack) => pack.moduleName === moduleName
    ? { ...pack, enabled, effectiveEnabled: enabled }
    : pack);
}

export function replacePackWithServerState(
  states: SelfServiceModuleState[],
  authoritative: SelfServiceModuleState,
): SelfServiceModuleState[] {
  return states.map((pack) => pack.moduleName === authoritative.moduleName
    ? authoritative
    : pack);
}

export function rollbackPackState(
  states: SelfServiceModuleState[],
  previous: SelfServiceModuleState,
): SelfServiceModuleState[] {
  return replacePackWithServerState(states, previous);
}
