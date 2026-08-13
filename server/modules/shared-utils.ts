import type { Request } from "express";

export type RouteUser = NonNullable<Request["user"]>;

export function getRequiredRouteUser(req: Request): RouteUser {
  if (!req.user) {
    throw new Error("Authenticated user missing");
  }
  return req.user;
}

export function getRequiredRouteUserId(req: Request): string {
  if (!req.userId) {
    throw new Error("Authenticated user ID missing");
  }
  return req.userId;
}

export function getRouteParam(value: string | string[] | undefined, name: string): string {
  if (typeof value === "string" && value) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0]) return value[0];
  throw new Error(`${name} is required`);
}

export function getPublicAppBaseUrl(): string {
  const configured = String(process.env.PUBLIC_APP_URL || "").trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  // Fallback for local development
  return "http://localhost:5173";
}
