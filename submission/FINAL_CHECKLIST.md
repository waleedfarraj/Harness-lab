# Final checklist (remaining tasks)

Status of the repo audit: checks pass (typecheck, lint, 248 tests, build, check:secrets). Nothing below has been done on your behalf; nothing is pushed, public, or deployed.

## Before making the repo public
- [ ] Review `git status` and `git diff`; commit the README, LICENSE-related files, `THIRD_PARTY_NOTICES.md`, `.gitignore` and `submission/*.md` changes.
- [ ] Decide on `demo-evidence/applypilot-regression/diagnosis.json`: it contains macOS temp-directory paths (`/var/folders/...`, no username or home directory) in `forkedFrom` and `sharedBaseCheckpoint`. The file is byte-for-byte recorded evidence with a sha256 in `provenance.json`, so it was left untouched. Publishing it as-is is low risk; scrubbing it would require regenerating the hash and provenance.
- [ ] Confirm `git log --all` has no history you want private (the audit found no secret values in history).
- [ ] Rotate the Nebius API key after the hackathon if it has been pasted anywhere outside `.env.local`.
- [ ] Verify the GitHub About box shows the MIT license and the demo link.

## Submission
- [ ] Upload the final video to YouTube as Public (see `YOUTUBE.md`); open the link in a private window.
- [ ] Mix the final narration with `harnesslab-screen-recording-final.webm` (the recording has no audio); confirm total under 3:00.
- [ ] Paste the YouTube link into Devpost (`DEVPOST.md`); complete every `[YOU: ...]` item, including the feedback section.
- [ ] Confirm "Existing project?" answer (first commit 2026-09-27).
- [ ] Check https://harnesslab-sooty.vercel.app in a private window (it deploys the replay; redeploy only if you want the latest commit live).
- [ ] Select track: Coding & Agentic Engineering. Submit before Oct 30, 2026, 10:00 am PDT (aim for Oct 27).

## Known honesty items
- [ ] The ApplyPilot replay header labels the runner "Nebius Token Factory Sandbox", while its Sandbox panel says local runner (it ran locally; only model calls used Token Factory). The README states this. Don't describe the ApplyPilot run as Sandbox-executed in the video or Devpost.
- [ ] In the video, say "legacy, single-run" over the interaction example.
- [ ] Say "replay of saved evidence" so viewers don't assume live Nebius calls.
- [ ] The video's closing tagline in the UI reads "Find what actually broke your coding agent."; the longer positioning line appears in the README/Devpost only.
