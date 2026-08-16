# Contributing to Proset CE

Thanks for helping! Proset CE is the community edition of Proset — the
self-hostable AI voice notes recorder. The hosted Proset (managed, cloud sync,
billing) is a separate private product; this repo is the open core.

## Ground rules

- **No secrets, ever.** No API keys, tokens, or credentials in code, commits,
  or issues. Use `process.env.*` + `.env.example`.
- **No billing code.** Stripe/RevenueCat/IAP belong to hosted Proset and are
  intentionally absent. Don't re-add them.
- **No super-admin / internal surfaces.** The hosted product has internal admin
  tooling that must never appear here.
- Keep the core promise: record → transcribe → tasks/emails/summaries.

## Setup

1. `cp .env.example .env` and fill in your Firebase + AI provider values.
2. `npm install`
3. `npm run server:build && npm start`

## Submitting changes

- Small, focused PRs with a clear description.
- Type-check before pushing: `npx tsc --noEmit`.
- Run the tests in `tests/` where they touch your change.
- If you touch `.env.example`, keep it documented and grouped.

## Code of conduct

Be kind, be specific, assume good intent. This is a solo-dev project — reviews
may take a little while.
