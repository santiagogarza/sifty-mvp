# Security findings ledger

Revision: `7dca4f4ab72ede551f592afb58f69616cb80b284`
Date: 2026-09-05

## Already in memory (skip)

12 prior findings including CVE-2025-55182, CVE-2025-55184, AI cap race, unbounded memories, etc.

## New candidates

### C-23864 — CVE-2026-23864 RSC/Server Function DoS on next@15.1.4

- Domain: Framework / dependencies
- Specialist: appsec-reviewer
- Status: validated
- Validation: independent verifier reran `node /tmp/sifty-security/validations/c-23864/assert-patched.mjs` unchanged; exit `1`; stderr `ASSERTION FAILED: next@15.1.4 is still in CVE-2026-23864 range >=15.1.0 <15.1.12` (`15.1.4 < 15.1.12`). Not a harness error (exit would be `2`). Artifact: `docs/security/validations/c-23864.md`.
- Attack chain: unauthenticated HTTP to App Router (`/sign-in`) → Flight/Server Function deserializer in next@15.1.4 / react@19.0.0 → CPU/memory exhaustion. Distinct from CVE-2025-55184 (patched 15.1.11; this CVE patched 15.1.12).
- Attacker: unauthenticated network
- Impact: availability of the Node/serverless process
- Confidence: medium-high (version in range + public App Router; decoder path without user `"use server"` is the challenged edge)
- Evidence: package.json:38,40-41; app/(auth)/sign-in/page.tsx:6-17; middleware.ts:45-48; GHSA-h25m-26qc-wcjf

### C-55183 — CVE-2025-55183 source disclosure

- Status: retracted
- Reason: no `"use server"` / Server Functions in repo; required leak sink absent

### C-29927 — CVE-2025-29927 middleware bypass

- Status: retracted (below reporting bar)
- Reason: APIs and settings/billing still call getSession; only empty HTML chrome is reachable. Self-only UI, no tenant data.

### C-BILL-TRIAL — deriveEntitlement ignores Stripe expired tier

- Status: retracted
- Reason: remaining 30-day trial after cancel is not a privilege above the original trial grant; perpetual-trial edge needs null trialStartedAt which signup always sets.

### C-IDOR — tenant APIs

- Status: retracted
- Reason: userId predicates on all CRUD; IdConflictError does not return foreign rows
