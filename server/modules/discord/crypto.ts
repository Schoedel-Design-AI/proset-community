import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface EncryptedDiscordSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

function encryptionKey(): Buffer {
  const source = process.env.DISCORD_PAYLOAD_ENCRYPTION_KEY
    || process.env.DB_ENCRYPTION_KEY
    || (process.env.NODE_ENV !== "production" ? process.env.BETTER_AUTH_SECRET : undefined);
  if (!source) throw new Error("DISCORD_PAYLOAD_ENCRYPTION_KEY is required");
  return createHash("sha256").update(source).digest();
}

export function encryptDiscordSecret(plaintext: string): EncryptedDiscordSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptDiscordSecret(value: EncryptedDiscordSecret): string {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(value.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function hashDiscordState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}
