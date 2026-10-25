# HarnessLab

**Find what broke your coding agent — and know when the evidence isn't strong enough to know.**

When a coding agent regresses after several harness changes at once (system prompt, skills, context policy, turn budget, model), it is hard to tell which change was responsible. HarnessLab runs controlled, replicated experiments over those changes and attributes the regression to a single dimension or to an interaction between dimensions, with the evidence behind the call.

HarnessLab does **not** always identify a root cause. Coding agents are stochastic, so it repeats important experiments, tracks stability, and reports **INCONCLUSIVE** when the evidence cannot support a unique diagnosis. That outcome is a feature, not an error.

Built for the Nebius x NVIDIA Global AI Hackathon 2026, Coding & Agentic Engineering track. MIT licensed.

**Live demo (read-only replay of saved evidence): https://harnesslab-sooty.vercel.app**. The hosted site makes no API calls and has no live agent execution; to run experiments, use the commands below.

## The problem

A coding agent's behavior depends on its *harness*: system prompt, skills, context policy, turn budget, model. Teams change several at once, performance drops, and it is unclear which change (or which combination) is responsible. Re-running by hand is slow, noisy and expensive.

## Core concepts

- **Baseline vs. candidate harness.** Two versioned harness manifests that differ in one or more dimensions, run on the same task fixture with the same hidden evaluator.
- **Controlled experiments.** Each experiment changes a chosen subset of dimensions back to their baseline or candidate values and runs the agent in an isolated workspace (a fork of a shared prepared checkpoint when using Token Factory Sandboxes). The evaluator runs build, public tests and hidden tests deterministically.
- **Adaptive diagnosis.** With *n* changed dimensions there are 2^n configurations. A deterministic planner picks the next experiment that best separates the remaining hypotheses (main effect of one dimension, or an interaction of several) instead of brute-forcing all of them. The page shows how many configurations were run and how many were avoided.
- **Replicated, stability-aware evidence.** Decision-critical configurations are repeated. A configuration whose runs disagree (for example PASS, FAIL, PASS) is labeled unstable, and unstable evidence cannot produce a confident verdict.
- **Honest INCONCLUSIVE.** If more than one hypothesis remains consistent with the evidence within budget, the diagnosis says so.
- **Evidence schemas.** Older saved examples (shown in the page's evidence switcher as "legacy schema") used a **single-run** schema, with no replication or stability tracking. A "legacy" decisive result is a historical single-run example, not current replicated evidence. Current-schema runs are replicated and may well be inconclusive.

## What it does

1. **Runs a coding agent** on a small task fixture (edit code, run tests and build) under an explicit, versioned *harness manifest*.
2. **Compares a baseline and a candidate harness** on the same task with a hidden evaluator, and detects a regression only when the evidence supports one.
3. **Attributes the regression** by running the changed dimensions in isolation under a run budget (deterministic planner, replicated runs, stability tracking). The outcome is a main effect, an interaction, or an honest "inconclusive".
4. **Explains the mechanism** with a single Nemotron call. The explanation never decides the diagnosis, and it is checked against the recorded traces.
5. **Shows it** on a judge-facing page that replays saved evidence with no API calls.

## Featured result: an ApplyPilot-derived experiment

ApplyPilot-AI is the author's separate job-search app. HarnessLab ran one real regression experiment on a task derived from its job-ranking rules (`fixtures/applypilot-rank`, from `services/job-dashboard/ranking.ts`).

| Configuration | Harness | Result |
| --- | --- | --- |
| Baseline | ApplyPilot's job-evaluation skill, full context | 2 of 2 PASS |
| Candidate | Generic "efficiency" skill, compact context | 2 of 2 FAIL |

Two dimensions changed (`skills`, `contextPolicy`). HarnessLab's diagnosis is a **main effect of `contextPolicy`**, evidence quality HIGH, from 6 recorded runs. With the original skill and only compaction changed, the agent failed the same way: compaction replaced the ranking contract with a placeholder, and the agent never saw its eligibility and pending-job rules again.

What this is **not**: not a live ApplyPilot integration (no ApplyPilot code, database or user data is touched, and ApplyPilot is unmodified), and not a benchmark. It is one task with 2 runs per configuration, so read the results as frequencies, not probabilities. The skill-only configuration was not run, so "the skill swap alone is harmless" is inferred by elimination, not observed. All of this, claim by claim, is in `demo-evidence/applypilot-regression/claim-audit.json` and on the page.

The ApplyPilot runs used the **local runner** for code execution; the model calls went to Nebius Token Factory. Other recorded experiments in the project (not bundled in the replay) used Token Factory Sandboxes.

## Quick start: replay the demo (no API key)

Requires Node.js 20.9 or newer.

```bash
npm install
npm run demo:replay            # prints a summary, then serves http://localhost:4000/
npm run demo:replay -- --summary-only   # summary only
```

This replays `demo-evidence/applypilot-regression/`, a byte-for-byte copy of a real recorded run (`provenance.json` holds its sha256 and the run ids). It makes no network calls and needs no credentials. `npm run dev` also serves the same page at `/`.

### Deploying the replay

The replay needs no environment variables. On Vercel, `vercel.json` is not required; `next.config.ts` bundles `demo-evidence/` with the page, and the credit-spending dev routes are always disabled when `VERCEL` is set. Deploy with `npx vercel@latest deploy --prod --yes`; `.vercelignore` keeps `.env*` and `.harnesslab/` out of the upload.

## Run the live experiment

Needs a Nebius Token Factory key.

```bash
cp .env.example .env.local     # then set NEBIUS_API_KEY
npm run diagnose:applypilot    # at most 10 real coding-agent runs + 1 Nemotron explanation call
```

It writes `.harnesslab/diagnoses/<id>.json` (git-ignored). The replay finds the best matching evidence by content, so a fresh run is picked up automatically; to keep it in the repo, run `npm run demo:freeze -- applypilot` (it refuses to overwrite a different existing snapshot). Results are stochastic. HarnessLab reports "no regression" or "inconclusive" when that is what the runs show.

Other experiments: `experiment:smoke`, `experiment:compare`, `experiment:interaction`, `experiment:skill-context`, `diagnose:stable` (npm scripts, see `package.json`), and the benchmark runner `scripts/benchmark-run.ts` (no npm alias: `node --conditions=react-server --env-file=.env.local --import tsx scripts/benchmark-run.ts --case=<id>`). Runner selection: `HARNESSLAB_RUNNER=local` (default) or `token-factory` (Token Factory Sandboxes; needs `NEBIUS_PROJECT_ID` and `pip install -r requirements-sandbox.txt`). There is no silent fallback between them.

## How NVIDIA Nemotron and Nebius Token Factory are used

- **Nemotron is the agent under test.** Every coding-agent run is a tool-calling loop against `nvidia/nemotron-3-super-120b-a12b` through Token Factory's OpenAI-compatible Chat Completions API (`src/lib/agent/coding-agent.ts`, `src/lib/nebius/client.ts`). Each run records tokens, latency and the turn-by-turn trace.
- **Nemotron writes the mechanism explanation.** One call per diagnosis, grounded in the recorded traces (`src/lib/diagnosis/explain-stable.ts`). The attribution itself is deterministic code, so the verdict doesn't depend on model prose.
- **Token Factory made repeated experiments affordable.** Attribution needs many replicated runs of the same task. Token Factory inference, and Token Factory Sandboxes for the runs that used them, are what make a 6 to 10 run diagnosis practical.
- The replay page does not call the API. The live path above does.

## Architecture

```
harness manifests (baseline, candidate)  ->  factorial design (2^n configurations)
        |                                              |
        v                                              v
  coding agent loop (Nemotron via Token Factory)   deterministic planner (explore / confirm)
        |                                              |
        v                                              v
  runner: local temp workspace  or  Token Factory Sandbox fork  ->  hidden deterministic evaluator
        |
        v
  replication + stability tracking  ->  attribution (main effect / interaction / inconclusive)
        |
        v
  Nemotron mechanism explanation (audited against traces)  ->  evidence JSON  ->  Next.js page
```

## Environment variables

Set in `.env.local` (git-ignored; copy from `.env.example`). Values are never committed.

| Variable | Needed for | Notes |
| --- | --- | --- |
| `NEBIUS_API_KEY` | live experiments | Token Factory API key. Server-side only. |
| `NEBIUS_BASE_URL` | optional | OpenAI-compatible endpoint; has a default. |
| `NEBIUS_MODEL` | optional | Defaults to `nvidia/nemotron-3-super-120b-a12b`. |
| `NEBIUS_TIMEOUT_MS` | optional | Request timeout. |
| `NEBIUS_PROJECT_ID` | `HARNESSLAB_RUNNER=token-factory` | Token Factory Sandboxes project. |
| `HARNESSLAB_RUNNER` | optional | `local` (default) or `token-factory`. |
| `HARNESSLAB_ENABLE_DEV_ROUTES` | optional | Enables credit-spending dev routes. Never set on a public deployment. |

The replay (`npm run demo:replay`) needs none of these.

## Layout

```
src/lib/agent/         coding-agent loop, tools, context policy ("full" | "compact")
src/lib/harness/       harness manifests, skills, diff, factorial design
src/lib/experiments/   task format, runners, evaluator, evidence, tasks/
src/lib/diagnosis/     planner, replication/stability, attribution, explanation
src/lib/demo/          evidence catalog, evidence locator, replay loader, trace findings
src/lib/view-model/    schema-agnostic view model for the UI
src/components/        judge-facing diagnosis page
fixtures/              task fixtures with hidden evaluator tests (incl. applypilot-rank)
demo-evidence/         tracked, replayable copy of the recorded ApplyPilot experiment
scripts/               experiment, diagnosis, benchmark and demo scripts
tests/                 node:test suites
```

## Checks

```bash
npm run typecheck
npm run lint
npm test               # no network, no API key
npm run build
npm run check:secrets  # after build: scans the client bundle for the key
```

## Security

- `NEBIUS_API_KEY` is read only in server-only modules; nothing uses `NEXT_PUBLIC_`. `.env*` is git-ignored except `.env.example`. If a key is exposed, rotate it in the Token Factory console.
- The Nemotron connectivity page (`/dev/nemotron-test`) and `POST /api/nemotron/test` spend credits for any caller, so they return 404 unless `HARNESSLAB_ENABLE_DEV_ROUTES=1`. Don't set it on a public deployment.
- `.harnesslab/` (raw run evidence) is git-ignored. Only the reviewed copy in `demo-evidence/` is tracked.

## Limitations

- Small samples: 2 to 3 runs per configuration, one task per scenario.
- Attribution covers the five harness dimensions in `src/lib/harness/types.ts`. Coding-agent tasks only.
- Raw model request bodies are not stored. What the model saw is reconstructed from recorded compaction metadata and the code that applies it.
- The ApplyPilot replay is a recorded run on the local runner; its page header still labels the runner as Token Factory Sandbox. The Sandbox evidence panel and this README are the accurate description. The other evidence examples in the switcher were run in Token Factory Sandboxes.
- The hidden evaluator tests live in `fixtures/*/hidden/` in this repo. They are kept out of the agent's workspace at run time (see the anti-leakage test), but anyone reading the repo can read them.
- The benchmark scenarios in `/benchmarks` all ended INCONCLUSIVE with low evidence quality (none produced a decisive diagnosis); one controlled seeded regression did not qualify. They are reported as-is and make no statistical-significance claim.
- Results come from a stochastic model; reruns can differ, and an unstable baseline is reported as such, not forced into a verdict.

## License

MIT. See `LICENSE`. `fixtures/duration-parse` is modeled on the documented behavior of the `ms` package (no source copied); see `THIRD_PARTY_NOTICES.md`.
