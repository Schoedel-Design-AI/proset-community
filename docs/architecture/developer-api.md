# Proset Developer API + MCP (v1)

Public, API-key-authenticated surface that lets developers and AI agents read a
user's Proset data and run transcription/conversion. Implements GitHub issue
#179 ("Proset API + Proset MCP").

Source lives in `server/modules/developer-api/` and is mounted in
`server/index.ts` via `registerDeveloperApi(app)`.

## Running on the Community Edition

This API ships with **Proset CE** — point your own AI tools (Claude Desktop,
Cursor, custom scripts) at **your own instance**:

- REST: `{your-ce-server}/api/v1` (e.g. `http://localhost:5000/api/v1` in dev)
- MCP: `{your-ce-server}/mcp`

**No tier gating on the CE**: every signed-in user gets the full API + MCP
surface. Only the per-user AI rate limit (10 req/min) and the CE instance's own
monthly usage caps apply.

**Bring your own models**: the CE has no access to the hosted Regular Edition's
managed AI pipeline — `transcribe`/`convert` run on the model keys you configure
for your instance (the same `AIFORMS_*` provider config the app uses), so API
usage draws on your own provider credits.

> Hosted [Proset.ai](https://proset.ai) exposes the same API surface, limited
> by plan tier — users with a hosted account can use it at their tier's
> allowances, and upgrade for more.

## Authentication

- Keys are created/revoked by a signed-in user under `POST /api/developer/keys`
  (session auth, i.e. the app's own login).
- **Keys expire by default — 90 days (GitHub posture).** Creation accepts
  `expiresInDays` (`30` | `90` | `365` | `"never"`); the server stores
  `expiresAt` and rejects expired keys with `401 expired_api_key`.
  `GET /api/developer/keys` returns `expiresAt` + an `expired` flag and omits
  revoked keys.
- A key looks like `proset_<64 hex>` (256 bits of CSPRNG). Only the **SHA-256
  hash** is stored in Firestore (`developerApiKeys` collection); the full secret
  is returned exactly once at creation.
- Authenticate requests with `Authorization: Bearer proset_...`.
- API access is **free for all signed-in users** (v1). Usage still counts
  against the user's existing transcription/conversion limits via the shared
  `checkLimit` / `incrementUsage` path.

## REST API — `{your-ce-server}/api/v1/*`

| Method | Path | Description |
| --- | --- | --- |
| GET | `/me` | Profile + tier + usage summary |
| GET | `/usage` | Full usage summary |
| GET | `/recordings` | List (paginated: `?page&limit&search`) |
| GET | `/recordings/:id` | Recording incl. transcript + conversions |
| GET | `/thought-threads` | List Thought Threads |
| GET | `/thought-threads/:id` | Thread + items + contexts |
| GET | `/folders` | List folders |
| GET | `/knowledge-bases` | List knowledge bases |
| POST | `/transcribe` | multipart `audio` **or** JSON `audio_base64` → transcript |
| POST | `/convert` | JSON `{ transcript, type, ... }` → artifact |

## MCP server — `{your-ce-server}/mcp`

Model Context Protocol server (streamable-HTTP transport,
`@modelcontextprotocol/sdk`). Point any MCP client (Claude Desktop, Cursor,
etc.) at `{your-ce-server}/mcp` with a `Bearer proset_...` header.

Tools: `list_recordings`, `get_recording`, `list_thought_threads`,
`get_thought_thread`, `list_folders`, `get_usage`, `transcribe`, `convert`.

## v1 scope (deliberate simplifications)

- `POST /convert` and the MCP `convert` tool run a **core conversion**: same
  prompt templates, model-routing chain, post-processing, and usage metering as
  the in-app `/api/convert` (SSE) endpoint, but return the full artifact as a
  single string. They do **not** yet assemble in-app personalization context
  (profile, style, history, custom skills/knowledge base, learnings) nor the
  live research ledger (OpenAlex / Semantic Scholar). The in-app endpoint keeps
  full parity.
- Large audio should use REST `/transcribe` (multipart, 500 MB multer limit).
  The MCP `transcribe` tool takes base64 and is bounded by the global 1 MB JSON
  body limit.

## Operational notes

- **Rate limiting** — `/api/v1/transcribe` and `/api/v1/convert` use a per-user
  10/min limiter (applied after API-key auth, keyed on `req.userId`), mirroring
  the in-app `aiLimiter`. All other v1 read endpoints fall under the generic
  100/min `/api/*` limiter.
- **Usage caps** — transcription and conversion honor the same `checkLimit`
  path as the in-app endpoints; on the CE every user resolves to the free-tier
  allowances with the instance's hard absolute caps as the ceiling.
- **MCP sessions are in-memory per instance** — the stateful streamable-HTTP
  session map (`transports` / `sessionUsers`) lives in the Node process. Under
  multi-instance scaling, a session created on one instance will not be found
  on another. For v1 this is acceptable at low traffic or with `min-instances=1`;
  the durable fix is either stateless MCP mode or a shared session store (Redis).
- **Account deletion** — `clearUserData` removes a user's developer API keys.

## Files

- `api-keys.ts` — key generation, hashing, bearer resolution, auth middleware.
- `router.ts` — `/api/developer` key CRUD + `/api/v1` REST.
- `conversion.ts` — `runCoreConversion` (non-streaming core conversion).
- `mcp.ts` — `McpServer` + streamable-HTTP transport (stateful sessions).
- `index.ts` — `registerDeveloperApi` mounting.
- `shared/schema.ts` — `DeveloperApiKey` type.
- `server/storage.ts` + `server/firestore-storage.ts` — `developerApiKeys` repo.
