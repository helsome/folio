# Desktop CI and release operations

## Artifact and trust contract

| Native runner | Installed program architecture | Installer |
|---|---|---|
| `macos-15` | Apple Silicon / arm64 | `Folio-<version>-mac-arm64.dmg` |
| `macos-15-intel` | Intel / x86_64 | `Folio-<version>-mac-x64.dmg` |
| `windows-2025` | Windows x64 / PE AMD64 | `Folio-<version>-win-x64.exe` (NSIS assisted installer) |

Bun is pinned to 1.4.2. Electron and electron-builder come from the frozen lockfile.
Builds run natively; no cross-architecture Electron distribution is reused.
The broken relative `electronDist` override is removed: electron-builder resolves the
locked Electron version and downloads the correct platform/architecture itself.
Tailwind/Lightning CSS/Rollup bindings are build-time native dependencies, installed
on each runner. The app main/preload and both extensions are bundled on that runner.
The Longbridge CLI is user-installed, never bundled (repository policy).

`pr.yml` validates typecheck, i18n, application build, focused tests, full isolated
unit tests and tracked-source secret scan. Full unit tests are mandatory on PRs
and main. PRs (including forks) and main call `desktop.yml` with read-only permissions,
no inherited secrets, and no persisted checkout credentials. Each native job builds
its installer, mounts the DMG or silently installs the NSIS EXE into a temporary
location outside the repository, checks Mach-O/PE architecture and ASAR build metadata,
checks main/preload/renderer/skills/extension resources, then runs packaged smoke and
first-launch/relaunch onboarding against that installed copy with clean user data.
A stale CDP port causes failure instead of validating another app process.
Upload happens only after these assertions pass. Main builds are downloadable Actions
artifacts, not GitHub Releases. `desktop.yml` also supports manual build-only dispatch.

`release.yml` runs on `v*` tags and manual dispatch. Both require an existing tag
matching root and Electron package versions. Manual dispatch must select that **tag ref**
(`refs/tags/v<version>`), not a branch even when it points to the same SHA;
the tag must point at the selected workflow commit;
the tagged commit must be an ancestor of main. Existing releases are never overwritten.
The next proposed version is **0.4.0-beta.3** because beta.2 already exists.
Do not create that tag before the PR review and native build evidence are complete.

Release additionally retains the existing golden-path A–H and v5 product assertions
on the installed app, on every native target. **These are not offline fixtures:**
`FINAGENT_AGENT_PROVIDER=local` only makes synthesis deterministic; several assertions
still need authenticated Longbridge capability data. Trusted release jobs now install **Longbridge 0.17.0** from exact upstream native
assets, with pinned SHA256 digests, into RUNNER_TEMP and update only that job's PATH.
No floating shell installer or OAuth login is run. A separate preflight extracts only
`LONGBRIDGE_APP_KEY`, `LONGBRIDGE_APP_SECRET`, `LONGBRIDGE_ACCESS_TOKEN` from the existing
`FINAGENT_ENV_FILE_CONTENT` secret (direct process env is also accepted locally).
The CLI supports this API-key environment authentication in its pinned
[upstream context implementation](https://github.com/longbridge/longbridge-terminal/blob/v0.17.0/src/openapi/context.rs).
Only a trusted version-tag release receives this secret; PR/main/build-only calls
receive none. No `.env`, token, keychain credential or new persistent credential is
created. The parsed credentials stay in the preflight/product-harness child process
environments; they are not passed to package builds, offline smoke/fresh-install,
GITHUB_ENV, logs or artifacts. Provider command output is captured and suppressed.
The preflight requires the locked CLI version and a usable real NVDA quote before
building, and repeats before installed golden/v5 gates. Missing prerequisites or
failed assertions block release with field names/status only.
No demo-data switch, skip, or `continue-on-error` substitutes for those gates.
A build-only report records these gates as `not-run`; the final release verifier
rejects such reports. The separate nightly live LLM/judge benchmark also remains
independent; its missing provider/judge prerequisites are not a code-CI pass.

## Signing and publication

The user authorized self-signing for this preview. It changes the publisher-trust
requirement only: installation, startup, real provider and product gates remain required.

By default **both macOS architectures** use ad-hoc signing (`identity=-`). Before
staging and again after copying the actual DMG, `codesign --verify --deep --strict`
checks code integrity and captured signing metadata must show `Signature=adhoc`, the
Folio bundle identifier and no Developer ID team/authority. This is **not Developer ID
signing** and has **no Apple notarization**. It does not establish a trusted publisher.

Windows uses a temporary RSA code-signing certificate created with .NET
`CertificateRequest` entirely in the signing process. The key must report
`RSACng.Key.IsEphemeral`; the workflow never exports PFX/PEM, writes a private key,
imports a certificate into any personal/root/trusted-publisher store, or changes OS
trust/execution policy. The certificate and key are disposed immediately after use.
`Set-AuthenticodeSignature` signs the final NSIS EXE with SHA256 and embeds only the
public signer certificate. If native signing cannot use the ephemeral key, the build
fails; there is no persistent-key fallback.

Windows integrity verification is independent of trust: .NET `SignedCms.CheckSignature`
validates the embedded CMS signature and the native Windows
[CryptSIPVerifyIndirectData](https://learn.microsoft.com/en-us/windows/win32/api/mssip/nf-mssip-cryptsipverifyindirectdata)
validates the actual PE content digest. A tampered section-byte copy must be rejected
before staging. Normal Authenticode verification must still report `NotTrusted`;
that trust error is **never** used as evidence of integrity. The signer public
certificate SHA256 fingerprint is stored in the manifest and checked again against
the distributed EXE before installation. The embedded main executable is covered by
the installer payload; this change does not claim a separate trusted signature on it.

Gatekeeper/SmartScreen may block these downloads. Generated-file runner smoke tests
verify installation/startup, not trust of an internet-downloaded application. Do not
install a root certificate, disable quarantine, or bypass system security prompts.

The existing optional formal Apple path remains available only for trusted macOS
release jobs, via explicit manual input `formal_apple_signing=true` (default false):
`APPLE_CERTIFICATE_BASE64`, `APPLE_CERT_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Existing Apple secrets are neither
required nor injected for this default self-signed release. Formal signing still
requires complete existing credentials, exact Developer ID/Team verification,
`codesign`, `stapler` and `spctl` verification before staging and after DMG installation.
It never silently falls back after an attempted formal-signing failure.

Complete preview releases remain internal **prereleases**, never marked latest.
Release notes report each target's actual ad-hoc/self-signed/formal signing and
notarization results. Self-signing proves integrity, not a trusted publisher identity.

Build jobs have `contents: read`. Only the final publish job has `contents: write`.
After ALL quality and native gates succeed, it downloads the current run's three
artifacts, rejects missing/extra/stale installers, verifies SHA256 and exact commit
identity against per-platform manifests/validation reports, and writes `SHA256SUMS.txt`.
It then creates a draft prerelease, uploads every asset and checks upload completion,
and finally publishes it as a prerelease with `make_latest: false`. An upload failure
attempts to delete the draft and fails the run. If cleanup itself fails, the remaining
draft must be inspected; it is never a successful public release. No incomplete public
release is created by an earlier failed platform build.

## Commands and maintainer actions

Local native build and installed-app checks:

```sh
bun install --frozen-lockfile
node scripts/release-package.mjs
node scripts/verify-installer.mjs
# Stronger existing product gates (requires real provider prerequisites):
FOLIO_RELEASE_GATES=1 node scripts/verify-installer.mjs
```

On PowerShell, set `$env:FOLIO_RELEASE_GATES = '1'` before the last command.
`bun run release:check` retains its unit/type/build/golden/package/smoke/fresh/v5 gates,
now using isolated tests and stopping at the first failure.

Maintainer operations using an already-authorized GitHub session (never create a token
for this task, expand permissions, or change branch protection):

```sh
# Confirm workflow state, then enable PR checks if still disabled.
gh api repos/helsome/folio/actions/workflows/pr.yml --jq '{id,state,path}'
gh workflow enable pr.yml --repo helsome/folio
# Re-trigger the PR via GitHub's normal synchronize/reopen event after enabling,
# or manually dispatch the standalone build workflow once registered on main:
gh workflow run desktop.yml --repo helsome/folio --ref main
```

New workflow files must first be present on the default branch for manual dispatch.
The Draft PR can run native builds through its PR workflow once `pr.yml` is enabled;
a maintainer may need to approve Actions execution. Do not merge solely to get a green
check. Review native evidence before marking Ready and merging.

Only after independent review/merge, all native artifacts, and live product gate
prerequisites are available, create a NEW tag at the reviewed main commit:

```sh
git fetch origin main --tags
git tag v0.4.0-beta.3 <reviewed-main-sha>
git push origin refs/tags/v0.4.0-beta.3
# Manual release: select the TAG ref (not main/a branch), with the matching tag input.
# This can retry a failed run only while no release already exists:
gh workflow run release.yml --repo helsome/folio --ref v0.4.0-beta.3 -f tag=v0.4.0-beta.3
```

In GitHub's Run workflow UI, select the version **tag**, then enter that same tag in
`tag`. In the REST dispatch body, `ref` must resolve to that tag; the `tag` input alone
does not change a selected branch into a tag. A branch dispatch at the identical
commit is rejected in preflight and cannot complete release. Standalone `desktop.yml`
build-only dispatch on `main` remains separate and never publishes.

The latest authorized enable retry failed during the metadata GET, before any enable
PUT: `Get "https://api.github.com/repos/helsome/folio/actions/workflows/pr.yml": Forbidden`.
An unauthenticated public API probe also failed with `CONNECT tunnel failed, response
403` and HTTP status `000`: the local proxy/transport blocked API connectivity, so no
GitHub permission rejection can be established from this error. `gh auth status`
separately reported the current GH_TOKEN as invalid; no alternate identity was used.
The PR workflow's live page still showed Disabled. Stop retrying this path; the minimum
user action is to open the PR checks Actions page in an existing authorized GitHub
session, choose Enable workflow, then trigger a normal PR synchronize/reopen event.
Direct git push has no shell credential;
the connected GitHub API can create branch/commit/PR but exposes no enable/dispatch/
release-create operation. A maintainer must perform the above actions through an
existing session.

Before release, the maintainer must confirm the **already-existing**
`FINAGENT_ENV_FILE_CONTENT` secret contains all three supported `LONGBRIDGE_*` fields
with valid existing market-data and read-account authorization. The cloud connector
cannot inspect secret inventory or availability, and no credential values were read.
If absent, this task stops at build artifacts: selecting/authorizing credential setup
is a separate user action, not something this workflow fabricates. Do not supply new
credentials in PR comments or conversation. Optional Apple configuration uses only the
five existing secret names listed above. The preflight is the definitive availability
check; neither the secret name in YAML nor local unit fixtures proves authentication. No service credential values were printed and no persistent credentials were created.
