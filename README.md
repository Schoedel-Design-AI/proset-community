# Proset CE — open-source AI voice notes recorder

**Proset CE is a memory helper: the self-hostable, open-source AI voice notes
recorder that makes sure you never lose or forget a vital idea.**

Record a spoken thought — walking, driving, or mid-idea — and Proset turns it
into a polished **email, task list, or summary**. Not just a transcript:
something you can actually act on.

> Hosted [Proset](https://proset.ai) is the managed version: cloud sync,
> reliable AI pipeline, no setup. This repo is the open core — **your code,
> your keys, your server**.

## Why Proset?

- **A memory helper** — vital ideas captured the moment they strike, never lost
- **Voice → action** — tasks, emails, and summaries, not just transcripts
- **Simple** — one tap record, no meeting bots, no setup
- **Affordable** — about half the price of the big voice-note apps
- **Web + Android**, English and Spanish, export to PDF/DOCX/CSV/Markdown

## Quickstart

> ⚠️ Proset CE is **bring-your-own-everything**: your AI provider key, your
> Firebase project, your email provider. Nothing is hosted for you.

1. **Prerequisites**: Node 20+, a Firebase project (Auth: Email/Password +
   Firestore), and one AI provider key (OpenAI / Groq / DeepSeek / Mistral /
   Fireworks).
2. **Configure**: `cp .env.example .env` and fill in the values (see the file
   for what each one does).
3. **Run**:
   ```bash
   npm install
   npm run server:build
   npm start
   ```
4. Open `http://localhost:5000`.

Or with Docker:

```bash
docker compose up -d --build
```

> ⚠️ The hosted Proset runs multi-provider AI routing and cloud sync; the CE
> routes to whichever provider key you set and stores recordings locally.

## Hosted Proset vs CE

| | **Proset (hosted)** | **Proset CE** |
|---|---|---|
| Setup | None — sign up | Your Firebase + AI keys |
| AI pipeline | Managed (multi-provider, automatic failover) | BYO key, single provider |
| Cloud sync | Included (Pro) / add-on (Base) | Self-managed |
| Billing | Free / Base / Pro | None (self-host) |
| Support | Maintained service | Community |

## Architecture

- `app/`, `components/`, `lib/`, `shared/` — React Native client (web + Android)
- `server/` — Express backend: auth, transcription, conversion, export
- `android/` — Android build
- `migrations/` + `firestore.rules` — database schema

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports:
[SECURITY.md](SECURITY.md).

## License

Apache-2.0 — see [LICENSE](LICENSE). The "Proset" name and the hosted product
are the trademark/property of Schoedel Design; this repo is the community
edition of the open core.
