# YouTube upload

**Visibility:** Public (not Unlisted). Length: 2:22 (limit: under 3:00). Video file: `harnesslab-screen-recording-final.webm` with the final narration (kept local, git-ignored).

## Title

HarnessLab: find what broke your coding agent, and know when the evidence isn't strong enough

## Description

Coding agents are configured by a harness: system prompt, skills, context policy, turn budget. Change several at once, performance drops, and nobody knows which change broke it.

HarnessLab compares a baseline and a candidate harness on the same task, runs controlled experiments with a hidden deterministic evaluator, and tries to isolate the responsible change or interaction. Because coding agents are stochastic, it repeats important experiments, tracks stability, and reports INCONCLUSIVE instead of inventing confidence.

What you see: a replay of saved real evidence (no live inference in this video). The coding agent is NVIDIA Nemotron 3 Super 120B A12B via Nebius Token Factory; experiments in the main example ran in Nebius Token Factory Sandboxes forked from a shared checkpoint. One earlier example uses the older single-run ("legacy") schema and is labeled as such.

Built for the Nebius x NVIDIA Global AI Hackathon 2026 (Coding & Agentic Engineering).

Live replay: https://harnesslab-sooty.vercel.app
Source (MIT): https://github.com/waleedfarraj/Harness-lab

#Nebius #NVIDIA #Nemotron #AIAgents #CodingAgents #Hackathon
