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
matching root and Electron package versions and pointing at the selected commit;
the tagged commit must be an ancestor of main. Existing releases are never overwritten.
The next proposed version is **0.4.0-beta.3** because beta.2 already exists.
Do not create that tag before the PR review and native build evidence are complete.

Release additionally retains the existing golden-path A–H and v5 product assertions
on the installed app, on every native target. **These are not offline fixtures:**
`FINAGENT_AGENT_PROVIDER=local` only makes synthesis deterministic; several assertions
still need authenticated Longbridge capability data. Hosted runners currently have no
verified CLI/auth setup. Missing prerequisites or failed assertions block release.
No demo-data switch, skip, or `continue-on-error` substitutes for those gates.
A build-only report records these gates as `not-run`; the final release verifier
rejects such reports. The separate nightly live LLM/judge benchmark also remains
independent; its missing provider/judge prerequisites are not a code-CI pass.

## Signing and publication

This implementation deliberately produces **unsigned internal previews only**:
macOS is not Developer-ID signed/notarized; Windows has no Authenticode signature.
Ambient signing credentials are removed from the packager child environment and no
new credentials are created. A local ad-hoc macOS signature, if Electron tooling
requires one, is not a verified publisher identity. No stable/signed release is claimed.
OS Gatekeeper/SmartScreen may block an unsigned download; do not disable or bypass
system security. A trusted signed release requires a separately reviewed integration
with output signature and notarization verification, not just checking for secrets.

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
# Or re-run the existing tag without overwriting a release:
gh workflow run release.yml --repo helsome/folio --ref v0.4.0-beta.3 -f tag=v0.4.0-beta.3
```

The cloud task's shell `gh` token was invalid and direct git push had no credential;
the connected GitHub API can create branch/commit/PR but exposes no enable/dispatch/
release-create operation. A maintainer must perform the above actions through an
existing session. No credential values were printed, generated or stored.
