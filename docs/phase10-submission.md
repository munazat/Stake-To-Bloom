# Submission checklist and draft

## Gate — do not mark complete until verified

- [ ] Public Pages URL opens in an incognito window on a different network.
- [ ] Hosted Supabase is configured and current; anonymous sign-in works.
- [ ] Sandbox buyer approval/capture, verified webhook, payout, refund, and audit receipt have been exercised with test accounts.
- [ ] `/demo` finishes in under 90 seconds; every simulated stake/day is labelled.
- [ ] All 15 chaos checks in the brief have been run against the deployed site.
- [ ] Safari, Firefox, mobile data, reduced motion, lite mode, and no-WebGL SVG fallback checked on real devices.
- [ ] `keepalive.yml` has a real configured run (not the missing-secrets no-op).
- [ ] README clean-clone setup and local demo steps pass from a fresh clone.
- [x] GitHub repository description/topics are set; GitHub detects the MIT license.
- [ ] `gitleaks detect` passes over the complete history.
- [ ] Video is public, English, captioned, under three minutes, and checked in incognito.
- [ ] Devpost details, demo URL, test instructions, video, and team roles are accurate; owner remains Representative.

## Devpost draft (not submitted)

**Title:** BloomStake — Grow a habit, stake a promise

**Short description:** A seven-day wellness pact turns verified daily progress into a living garden. Gemini extracts evidence; a deterministic referee decides; sandbox-only settlement returns stakes according to the frozen rules.

**What we built:** A React/Supabase wellness commitment app with a procedural garden, multimodal proof observations, deterministic rule evaluation, guarded PayPal Sandbox payouts/refunds, an audit feed, and a 90-second guided demo with visibly simulated peers.

**How AI is used:** Gemini reports structured observations from proof images. Its output is treated as untrusted data. A deterministic gate compares it with the pact’s frozen rule. AI never determines money or calls payment tools.

**Testing instructions:** Use the public demo URL only after hosted acceptance is verified. Use sandbox buyer credentials shared privately with judges; never put passwords in this draft or the repository. Use `/demo` for the no-credential simulated tour.

**Tools:** React, TypeScript, Supabase, Google Gemini, PayPal Sandbox, Vite, Vitest, Deno, pgTAP. Explain the role and limitations of each in the final submission.

**Team:** Owner — Representative. Add the relative only if they are actually participating, with their honest role and consent.

**Links/screenshots/video:** Pending hosted deployment and owner-provided/public artifacts. Do not invent URLs or claim live acceptance before it is observed.
