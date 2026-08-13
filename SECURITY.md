# Security

Proset CE is the open-core community edition. The hosted Proset (managed
service) is a separate product with its own security practices.

## Reporting a vulnerability

**Do NOT open a public issue.** Email the maintainers via
https://proset.ai/support/ or open a GitHub security advisory
(Security → Report a vulnerability).

Include: affected version, a minimal reproduction, and impact. We aim to
acknowledge within 5 business days.

## Supported surface

- The CE codebase itself (client + self-hosted server).
- Self-hosted deployments are BYO-key: you control your AI provider keys,
  Firebase project, and storage. Credentials live in your `.env` — keep it
  out of git (it is gitignored).

## What this repo does NOT cover

- Hosted Proset infrastructure (Cloud Run, Firebase project, billing) — that
  surface is private and not in scope here.
- Misconfiguration of your own deployment (e.g., publishing your `.env`).
