# Security findings ledger — sifty-mvp

- Revision: `7dca4f4ab72ede551f592afb58f69616cb80b284`
- Branch: `cursor/vulnerability-finding-management-bc30`
- Last verifier update: 2026-09-07

| ID | Title | Domain | Status | Validation / retraction |
| --- | --- | --- | --- | --- |
| C1 | Next.js App Router unpatched for CVE-2026-23869 (CPU DoS via Server Action decoder) | Framework / RSC decoder | **validated** | `docs/security/validations/C1.md` |
| C2 | WebSocket SSRF CVE-2026-44578 | Framework / network | retracted | Vercel-hosted deployment not affected |
| C3 | Unbounded task storage DoS | Tenant data APIs | retracted | Duplicate class of prior memories finding |

## C1 (validated)

- Evidence: `package.json` pins `next@15.1.4` and `react@19.0.0`; `action-handler.js` calls `decodeReplyFromBusboy` before `getActionModIdOrError` on Node multipart fetch actions.
- Attack chain: unauthenticated `POST` with `Next-Action` + multipart body → framework decoder on a public App Router route → Flight deserialize before action-id lookup → CPU DoS (CVE-2026-23869). Patched floor `next >= 15.5.15`.
- Attacker: unauthenticated HTTP client. Deployment: Node Next server (`next start` / Vercel Node).
- Independent rerun: `python3 /tmp/security-review/validate_cve_2026_23869.py` in `/workspace` exited `1` with `AssertionError: CVE-2026-23869: next@15.1.4 is in affected range >=13.0.0 <15.5.15; expected >=15.5.15`.
