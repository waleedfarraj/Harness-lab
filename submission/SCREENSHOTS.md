# Recommended screenshots

Take these from the production build (`npm run build && npm start`, port 4000) at 1440x900, browser window only, no bookmarks bar. Evidence is shown exactly as saved. Scroll offsets are approximate pixels from the top.

| # | URL | Scroll | Why |
|---|---|---|---|
| 1 | `/?evidence=inconclusive` | 0 | Hero: HarnessLab, tagline, task, Nemotron model, Nebius Token Factory Sandbox runner, overview flow ending "Inconclusive — honestly reported". Best thumbnail. |
| 2 | `/?evidence=inconclusive` | ~1640 | Search space: 4 dimensions, 16 configurations, 5 executed, 11 avoided (68.8%), colored PASS/FAIL grid. |
| 3 | `/?evidence=inconclusive` | ~2060 | Diagnosis trace: Explore steps with "why this experiment", eliminated and remaining hypotheses. |
| 4 | `/?evidence=inconclusive` | page bottom | Sandbox evidence: Nebius Token Factory Sandbox and NVIDIA Nemotron badges, shared checkpoint, 5 forks, hidden-test sentence. Sponsor shot. |
| 5 | `/?evidence=interaction` | 0, then ~2560 | Legacy example: the "Interaction (legacy schema)" tab, then "Interaction detected: Skill x Context Policy". Keep the legacy label in at least one frame. |
| 6 | `/?evidence=interaction-attempt` | ~3880 | Stability: PASS / FAIL / PASS, 33.3%, "Unstable — disagreeing runs", evidence quality LOW. Honest-uncertainty shot. |
| 7 | `/?evidence=interaction-attempt` | ~3800 | The "Evidence insufficient for a unique diagnosis" box (take together with 6 if both fit). |
| 8 | `/benchmarks` | 0 to ~450 | Benchmark overview and case table. Stop above the footer note that names `.harnesslab/` directories. |
| 9 | `/` (ApplyPilot replay) | ~3350 | "What the agent did differently": compaction replaced the contract file with a placeholder. Label as a local-runner replay. |

Avoid: the Sandbox panel of the ApplyPilot page (shows a truncated local temp path), and the `/benchmarks` footer.
