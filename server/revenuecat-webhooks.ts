// CE stub — RevenueCat webhooks are hosted-only in Proset.

import type { Request, Response } from "express";

export async function handleRevenueCatWebhook(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ ok: true });
}

export async function syncRevenueCatUser(_userId: string): Promise<void> {}
