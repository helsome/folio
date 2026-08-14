# Longbridge Auth — V4 Decision (Lead, spec §8–11)

## Decision: CLI Device Authorization Flow, orchestrated by the main process

Longbridge CLI 0.17.0 (verified locally) provides everything needed for an
in-app, no-terminal connect flow:

- `longbridge auth login --format json` — Device Authorization Flow
  (RFC 8628) by default: prints a `verification_uri`, the user opens it in ANY
  browser, the CLI polls until authorized. No localhost callback needed.
  (`--auth-code` flow exists but requires a browser on the same machine and a
  localhost listener — do not use.)
- `longbridge auth status --format json` →
  `{ account: { account_no, account_type, member_id, name, quote_level },
     token: { logged_in_at, path, status: "valid" | … } }`
  — the connection-health and permission source. `quote_level` encodes per-
  market entitlement (e.g. `USAB:…|Global|Delay` = delayed US quotes;
  `HKAA:…|Global|LV2` = HK level-2). Parse it into `ProviderPermission[]`.
- `longbridge auth logout` — clear stored token (Disconnect).
- `longbridge check --format json` → `{ connectivity: {cn, global}, region:
  {active}, session: {token, detail} }` — Test Connection + diagnostics.
- `longbridge --version` → `longbridge 0.17.0` — install state + diagnostics.

## Flow (Connections UI → main process)

1. `Connections → Longbridge → Connect` → main runs `longbridge auth login
   --format json`, parses `verification_uri`, opens it with
   `shell.openExternal`, reports `connecting`.
2. Main polls `longbridge auth status --format json` (e.g. every 3s, timeout
   180s) until `token.status === 'valid'` → `connected` + health snapshot
   (account identity, permissions, region).
3. Timeout / user cancel → kill the login process, status `not-connected`
   (or `expired` if a token previously existed).
4. Disconnect → `longbridge auth logout` → `not-connected`.
5. CLI missing → `not-installed`; UI shows [Install / Setup] that opens the
   official Longbridge setup docs (never curl|sh).

Renderer NEVER spawns a shell; all CLI interaction stays in the main process
(same pattern as the existing executor).

## Permission → status mapping (spec §8)

- token missing → `not-connected`
- login in flight → `connecting`
- token valid, all expected entitlements present → `connected`
- token valid, quote_level shows Delayed-only or missing markets →
  `permission-limited` (permissions[] carries the detail)
- token status not valid (expired/revoked) → `expired`
- status/check command failure → `error` (message user-safe)

## Note for the connector

`quote_level` values are market-prefixed (SHAB/HKAB/USAB/SZAD/…). Map the
well-known prefixes to markets (US/HK/CN/SG) and treat `Delay`/`LV0` as
delayed-permission entries. Unknown values: pass through as granted=false
with the raw label — never fabricate.
