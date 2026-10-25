# HarnessLab: Devpost submission draft

Fill the `[YOU: ...]` items before submitting. Everything else is drawn from the repo and the recorded evidence.

## Form fields

- **Project name:** HarnessLab
- **Tagline (short):** Find what broke your coding agent — and know when the evidence isn't strong enough to know.
- **Track:** Coding & Agentic Engineering
- **Demo URL:** https://harnesslab-sooty.vercel.app
- **Code repository:** https://github.com/waleedfarraj/Harness-lab (public, MIT)
- **Video (YouTube, public, 2:22):** [YOU: paste link after upload]
- **Built with:** Nebius Token Factory, NVIDIA Nemotron (`nvidia/nemotron-3-super-120b-a12b`), Nebius Token Factory Sandboxes, Next.js 16, React 19, TypeScript, Tailwind CSS, Node.js, Vercel
- **Existing project?** No. The first commit is dated 2026-09-27, after the submission period opened (Aug 26), so no "significantly updated" explanation is needed. [YOU: confirm no earlier private work.]

## Text description (paste into "About the project")

### The problem

Coding agents are configured by a *harness*: system prompt, skills, context policy, turn budget, model. Teams change several of these at once, a regression appears, and nobody knows which change caused it, or whether it took two changes interacting. Re-running by hand is slow, noisy (models are stochastic), and expensive.

### What HarnessLab does

HarnessLab is a regression-attribution tool for coding agents.

1. **Runs a coding agent** on a small task (edit code, run tests and the build) under an explicit, versioned harness manifest, with a hidden evaluator that checks requirements the agent can only get right if it keeps the contract in view.
2. **Detects a regression** by comparing a baseline and a candidate harness on replicated runs, and only when the evidence supports one.
3. **Attributes it** by running the changed dimensions in isolation under a run budget. A deterministic planner picks the next experiment, tracks stability, and ends with a main effect, an interaction, or an honest "inconclusive".
4. **Explains the mechanism** with one Nemotron call, then checks every claim against the recorded traces.
5. **Shows it** on a judge-facing page that replays saved evidence with no API calls.

### What the demo video shows

All pages are a read-only replay of saved evidence; nothing in the video is live inference.

- **A current-schema diagnosis that ends INCONCLUSIVE.** A four-dimension change (system prompt, skill, context policy, max turns) on a discount-code task: 16 possible configurations, 5 run, 11 avoided, 10 coding-agent runs inside Nebius Token Factory Sandboxes forked from one shared checkpoint, scored by a hidden deterministic evaluator. Two hypotheses stay consistent with the evidence, so HarnessLab reports "Evidence insufficient for a unique diagnosis".
- **An earlier resolved interaction (legacy, single-run schema).** Skill x Context Policy, shown with its "legacy schema" label. It is a historical single-run example, not replicated evidence.
- **Replicated uncertainty.** One configuration produced PASS, FAIL, PASS (33.3% failure over 3 runs) and is classified unstable, which is why the diagnosis stays inconclusive instead of claiming a cause.
- **Benchmarks.** Four natural scenarios all ended inconclusive with low evidence quality, and a controlled seeded regression did not qualify. They are reported as-is, with no statistical-significance claim.

### The featured result: a regression in an ApplyPilot-derived task

ApplyPilot is my own job-search app. I turned its job-ranking rules into a small task and ran a real experiment:

- **Baseline** (ApplyPilot's job-evaluation skill, full context): 2 of 2 runs pass.
- **Candidate** (a generic "efficiency" skill, compact context): 2 of 2 runs fail.
- **HarnessLab's diagnosis:** a main effect of the **context policy**, evidence quality HIGH, from 6 recorded runs. The traces show why: at turn 4 compaction replaced the 2,021-character ranking contract with a 75-character placeholder, so the agent never saw the eligibility and pending-job rules again.

It is not a live ApplyPilot integration: no ApplyPilot code, database, or user data is touched, and ApplyPilot is unmodified.

### How we use NVIDIA Nemotron and Nebius Token Factory

- **Nemotron is the agent under test.** Each run is a tool-calling loop against `nvidia/nemotron-3-super-120b-a12b` through Token Factory's OpenAI-compatible API. Every run records tokens, latency, and a turn-by-turn trace. The six recorded runs used about 85k input and 6k output tokens in roughly a minute of agent time.
- **Nemotron explains the mechanism.** One call per diagnosis, grounded in the recorded traces. The verdict itself is deterministic code, so it doesn't depend on model prose.
- **Token Factory is what makes attribution affordable.** Diagnosis needs many replicated runs of the same task; fast, cheap inference turns that from an afternoon into about a minute. Earlier experiments in the project (the benchmark scenarios) ran inside Token Factory Sandboxes; the ApplyPilot runs executed code in local temp workspaces, with model calls through Token Factory.

### Honesty and limitations

HarnessLab reports what it can support, and does not claim to always find a root cause. The ApplyPilot result is one task with 2 runs per configuration, so read it as frequencies, not probabilities. "The skill swap alone is harmless" is inferred by elimination, because that configuration was not run. Raw model request bodies aren't stored. An earlier attempt at the same experiment had an unstable baseline and was correctly reported as "no attributable regression"; it's not used in the demo. The hosted site is a read-only replay of the saved real run: it makes no API calls and can't launch experiments. Live experiments run from the command line (`npm run diagnose:applypilot`).

### What's next

Cover more harness dimensions (tools, permissions, model), larger task suites, and a hosted runner with guardrails so teams can point HarnessLab at their own agents.

### Try it

- Hosted replay: https://harnesslab-sooty.vercel.app
- Local replay, no API key: `npm install && npm run demo:replay`
- Live run (needs a Token Factory key): `npm run diagnose:applypilot`
- Source and instructions: https://github.com/waleedfarraj/Harness-lab

## Feedback section (required for the feedback prize; keep it specific)

Grounded in what the repo history shows. Add your own observations where marked.

- **Nebius Token Factory:** The OpenAI-compatible Chat Completions endpoint worked well for a tool-calling agent loop, and usage fields (input/output tokens) made per-run cost accounting straightforward. During setup, `nvidia/nvidia-nemotron-3-nano-30b-a3b` returned HTTP 404 on the documented endpoint, so a list of the models enabled per account or region, discoverable from the API, would save time. [YOU: add latency, rate-limit, or error-handling observations from your runs.]
- **Token Factory Sandboxes (beta):** Access was gated at the start of the project, so integration waited on beta access. Once available, fork-from-checkpoint was a natural fit for isolating one harness dimension per run. [YOU: add notes on checkpoint/fork speed, the Python bridge, and docs gaps.]
- **NVIDIA Nemotron (`nemotron-3-super-120b-a12b`):** Followed multi-step tool use reliably in short loops. Its mechanism explanations are plausible but overstate details (for example, attributing a fixed tool behavior to the changed dimension), which is why HarnessLab audits each claim against traces instead of trusting the prose. [YOU: add observations on tool-call reliability, long-context behavior, and output variance across identical runs.]
- **Suggestion:** Per-request trace export from Token Factory would let tools like this reconstruct exactly what the model saw without storing request bodies ourselves.

## Pre-submit checklist

- [ ] Video public on YouTube; link opens in a private window; under 3:00 (final cut is 2:22).
- [ ] Demo URL opens in a private window and shows the ApplyPilot replay.
- [ ] Repo is public, MIT shows in the About box, README has the demo link.
- [ ] Track selected: Coding & Agentic Engineering.
- [ ] Feedback section completed (it also makes you eligible for the feedback prize).
- [ ] Submitted well before **Oct 30, 2026, 10:00 am PDT** (aim for Oct 27).
