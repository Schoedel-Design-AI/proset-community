// CE stub — Stripe webhooks are hosted-only in Proset.

export const WebhookHandlers = {
  async processWebhook(
    ..._args: unknown[]
  ): Promise<{ status: number; body?: string }> {
    return { status: 400, body: "Billing is not available in Proset CE" };
  },
};
