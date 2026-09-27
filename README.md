# HarnessLab

When a coding agent regresses after several harness changes, it is hard to tell which change broke it. HarnessLab will run controlled experiments across harness dimensions (model, system prompt, skills, MCP/tools, permissions, context policy) in isolated Token Factory Sandboxes, using NVIDIA Nemotron models through Nebius Token Factory, to find the single change, or the interaction between changes, that caused the regression. Built for the Nebius x NVIDIA Global AI Hackathon 2026 (Coding & Agentic Engineering track).

## Milestone 0

This version checks only these four things:

- **Token Factory connectivity**: a server-side call to the OpenAI-compatible Chat Completions endpoint.
- **NVIDIA Nemotron inference**: a prompt sent to a Nemotron model, with the response, model, latency and token usage displayed.
- **Secure configuration**: the API key is read only on the server, checked at request time, and never sent to the browser or committed.
- **Future sandbox abstraction**: a `SandboxRunner` interface plus a placeholder adapter that refuses to run until Sandbox access exists.

### Layout

```
src/
  app/
    page.tsx                     # one test page (client component)
    api/nemotron/test/route.ts   # POST /api/nemotron/test (Node runtime)
  lib/
    nebius/config.ts             # env loading + validation (server-only)
    nebius/client.ts             # runNemotron(): the only Token Factory caller (server-only)
    sandbox/types.ts             # SandboxRunner boundary (HarnessLab's own types)
    sandbox/token-factory-runner.ts  # placeholder; always throws
  types/nemotron.ts              # API response shape shared by route and page
tests/                           # node:test unit tests (run with tsx)
scripts/check-client-bundle.mjs  # scans the built client JS for secrets
```

## Setup

Requires Node.js 20.9 or newer.

```bash
# 1. Install dependencies
npm install

# 2. Create your local env file (git-ignored)
cp .env.example .env.local

# 3. Add your Nebius API key: edit .env.local and set
#    NEBIUS_API_KEY=<your key from https://tokenfactory.nebius.com>
${EDITOR:-nano} .env.local

# 4. (Optional) Change the endpoint or model in .env.local. Defaults (verified live):
#    NEBIUS_BASE_URL=https://api.tokenfactory.us-central1.nebius.com/v1
#    NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b
#    Use any Nemotron model ID your account can access.
#    nvidia/nvidia-nemotron-3-nano-30b-a3b returned HTTP 404 (model not found)
#    when live-tested against this endpoint; it is not a working default.

# 5. Start the dev server
npm run dev

# 6. Run the Nemotron test: open http://localhost:3000 and click "Run Nemotron",
#    or call the endpoint directly:
curl -s -X POST http://localhost:3000/api/nemotron/test \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Say hello in one sentence."}'
```

### Environment variables

| Variable | Required | Default |
| --- | --- | --- |
| `NEBIUS_API_KEY` | yes | none |
| `NEBIUS_BASE_URL` | no | `https://api.tokenfactory.us-central1.nebius.com/v1` |
| `NEBIUS_MODEL` | no | `nvidia/nemotron-3-super-120b-a12b` |
| `NEBIUS_TIMEOUT_MS` | no | `60000` |

The config is checked on every request. If the key is missing, the base URL is not `https`, or the timeout is not a positive integer, the endpoint returns HTTP 500 with `code: "config_missing"` and a message that names the variable at fault.

### API

`POST /api/nemotron/test` with body `{ "prompt": "..." }`

Success (200):

```json
{
  "success": true,
  "model": "nvidia/nemotron-3-super-120b-a12b",
  "output": "...",
  "latencyMs": 1234,
  "finishReason": "stop",
  "usage": { "inputTokens": 123, "outputTokens": 45, "totalTokens": 168 }
}
```

`usage` is `null` when the provider returns no usage data. Individual counts are `null` when they are missing. Nothing is estimated.

Errors return `{ "success": false, "error": { "code", "message" } }`:

| code | HTTP | When |
| --- | --- | --- |
| `malformed_request` | 400 | body is not JSON, or `prompt` is missing, empty or longer than 8000 characters |
| `config_missing` | 500 | required config is missing or invalid |
| `auth_failed` | 502 | provider returned 401/403 |
| `provider_error` | 502 | any other non-2xx from the provider (message truncated, key redacted) |
| `invalid_response` | 502 | provider returned no text content |
| `network_error` | 502 | the provider could not be reached |
| `timeout` | 504 | no response within `NEBIUS_TIMEOUT_MS` |

### Checks

```bash
npm run lint
npm run typecheck
npm test               # config, client (mocked fetch), route and sandbox tests
npm run build
npm run check:secrets  # after build: scans .next/static for the key and for "NEBIUS_API_KEY"
```

## Security

- **Never commit `.env.local`.** It holds your real API key. `.gitignore` ignores `.env` and every `.env.*` file except `.env.example`, which holds only placeholders. To confirm, run `git check-ignore -v .env.local`.
- The key is read only in `src/lib/nebius/config.ts`, which imports `server-only`. If a client component imports it, the build fails.
- No variable uses the `NEXT_PUBLIC_` prefix, so Next.js never inlines them into browser bundles. `npm run check:secrets` confirms this on the built output.
- Error responses carry only a short, sanitized message. Provider error text is truncated to 200 characters, and any echoed key or `Bearer` token is redacted. Server logs record only the error code and HTTP status.
- If a key is ever exposed, rotate it in the Token Factory console.

## Current limitations

- Sandbox integration is waiting on beta access. `TokenFactorySandboxRunner` throws `Token Factory Sandbox access not configured` for every call and does not simulate a sandbox.
- There is no experiment engine yet.
- There is no harness diagnosis yet.
- There is no persistence. Nothing is stored.
- There is no production deployment. The app is for local development only.
