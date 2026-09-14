import { randomBytes } from "node:crypto";
import type { DiscordLinkState, DiscordLocale } from "@shared/schema";
import { storage } from "../../storage";
import {
  DISCORD_LINK_TTL_MS,
  discordPublicBaseUrl,
  requireDiscordApplicationId,
} from "./config";
import { hashDiscordState } from "./crypto";

function newState(): string {
  return randomBytes(32).toString("base64url");
}

async function persistState(input: {
  kind: DiscordLinkState["kind"];
  discordUserId: string;
  userId?: string;
  locale: DiscordLocale;
}): Promise<string> {
  const raw = newState();
  const stateHash = hashDiscordState(raw);
  const now = new Date();
  await storage.discordLinkStates.create({
    id: `discord_link_${stateHash}`,
    kind: input.kind,
    stateHash,
    discordUserId: input.discordUserId,
    userId: input.userId ?? null,
    applicationId: requireDiscordApplicationId(),
    locale: input.locale,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DISCORD_LINK_TTL_MS).toISOString(),
    consumedAt: null,
  });
  return raw;
}

export async function createDiscordCommandLink(
  discordUserId: string,
  locale: DiscordLocale,
): Promise<string> {
  const state = await persistState({ kind: "command", discordUserId, locale });
  return `${discordPublicBaseUrl()}/discord/link?state=${encodeURIComponent(state)}`;
}

export async function beginDiscordOAuth(
  commandState: string,
  userId: string,
): Promise<string | null> {
  const consumed = await storage.discordLinkStates.consume(hashDiscordState(commandState), new Date(), "command");
  if (!consumed) return null;

  const oauthState = await persistState({
    kind: "oauth",
    discordUserId: consumed.discordUserId,
    userId,
    locale: consumed.locale,
  });
  const redirectUri = `${discordPublicBaseUrl()}/api/discord/oauth/callback`;
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", requireDiscordApplicationId());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", oauthState);
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export interface DiscordOAuthIdentity {
  id: string;
  username?: string;
}

export async function completeDiscordOAuth(code: string, rawState: string): Promise<{
  result: "success" | "invalid_state" | "identity_mismatch" | "discord_in_use" | "user_has_other" | "oauth_failed";
  locale?: DiscordLocale;
}> {
  const state = await storage.discordLinkStates.consume(hashDiscordState(rawState), new Date(), "oauth");
  if (!state || !state.userId) return { result: "invalid_state" };

  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
  if (!clientSecret) throw new Error("DISCORD_CLIENT_SECRET is required");
  const redirectUri = `${discordPublicBaseUrl()}/api/discord/oauth/callback`;
  try {
    const body = new URLSearchParams({
      client_id: state.applicationId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
    const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResponse.ok) return { result: "oauth_failed", locale: state.locale };
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) return { result: "oauth_failed", locale: state.locale };

    const identityResponse = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!identityResponse.ok) return { result: "oauth_failed", locale: state.locale };
    const identity = await identityResponse.json() as DiscordOAuthIdentity;
    if (identity.id !== state.discordUserId) {
      return { result: "identity_mismatch", locale: state.locale };
    }

    const linked = await storage.accounts.linkDiscord(state.userId, identity.id, new Date());
    if (linked.status === "discord_in_use" || linked.status === "user_has_other") {
      return { result: linked.status, locale: state.locale };
    }
    return { result: "success", locale: state.locale };
  } catch (error) {
    console.error("[discord] OAuth completion failed:", error);
    return { result: "oauth_failed", locale: state.locale };
  }
}
