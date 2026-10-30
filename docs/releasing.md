# Releasing Overlay

Installers are published as GitHub Release assets, so a download is the plain `.exe` and not a zipped
Actions artifact. Releases go to a separate releases-only repository, `peter-swiatek/overlay-releases`
by default.

## Versions

The single source of truth is `version` in `apps/desktop/package.json`. The root `package.json` stays
private and unversioned. `apps/desktop/scripts/version.mjs` turns it into a build version:

| Build                    | Version                       | Channel   | Installer                          |
| ------------------------ | ----------------------------- | --------- | ---------------------------------- |
| Tag push `v0.1.0`        | `0.1.0` (must equal the tag)  | `release` | `Overlay-Setup-0.1.0.exe`          |
| CI build (`ci.yml`)      | `0.1.0-ci.<run number>`       | `dev`     | `Overlay-Setup-0.1.0-ci.123.exe`   |
| Release dispatch         | `0.1.0-dev.<run number>`      | `dev`     | `Overlay-Setup-0.1.0-dev.123.exe`  |
| Local `dist:win`         | `0.1.0-local`                 | `local`   | `Overlay-Setup-0.1.0-local.exe`    |

- The app shows the version in the tray tooltip, a disabled tray menu item, and the settings header.
  Dev builds display `0.1.0-ci.123+abc1234` (on pull requests the sha is the PR head) (short sha as semver build metadata). The `+sha` form is
  display only; electron-builder and file names never see a `+`.
- Windows file properties: the app exe has FileVersion and ProductVersion `0.1.0.<run number>`; the
  installer ProductVersion string is the full version, for example `0.1.0-ci.123`. Local builds use
  run number 0.
- The build info (version, sha, UTC build date, channel) is embedded at build time from the
  `OVERLAY_VERSION`, `OVERLAY_CHANNEL`, `OVERLAY_SHA` and `OVERLAY_BUILD_DATE` environment variables.
  Without them (a local `pnpm --filter @overlay/desktop build`) it defaults to `<version>-local`.
- `pnpm --filter @overlay/desktop dist:win` runs `scripts/dist-win.mjs`, which packages as
  `<version>-local`, so a local installer name can never collide with a CI or release one.
- The workflows run `scripts/version-cli.mjs`, which writes the `OVERLAY_*` variables to `$GITHUB_ENV`;
  a follow-up step fails the job if `OVERLAY_VERSION` is not set.

## Cutting a release

1. Make sure `apps/desktop/package.json` has the version you want to ship, for example `0.1.0`, and
   that it is merged to `main`.
2. Tag and push:
   ```
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. The `Release` workflow lints, type-checks and tests, builds the installer, and creates the release
   `v0.1.0` in the releases repo with the assets below. If the tag and `package.json` disagree, the
   workflow fails at the "Compute version" step before building anything.
4. Bump `apps/desktop/package.json` to the next patch (for example `0.1.1`) so later dev builds
   (`0.1.1-ci.N`) sort above the release.

A tag with a prerelease part (`v0.2.0-rc.1`) is published as a prerelease automatically. Re-running the
workflow for the same tag replaces the assets (`--clobber`).

## Prerelease from a branch (workflow_dispatch)

Run the `Release` workflow manually from the Actions tab and pick a **branch**. The version is the dev
version (`0.1.0-dev.<run>`), the tag is `v0.1.0-dev.<run>`, and the release is always a prerelease (and
never marked "latest"). Dispatching on a tag is rejected, so a stable release is never rebuilt or
changed from the Actions tab; to redo a stable release, re-run the tag's workflow run.

Releases are created as drafts, assets are uploaded, and only then is the draft published, so a failed
upload never leaves an empty public release. Stable releases are marked "latest"; prereleases are not.

## What appears in the release

- `Overlay-Setup-<version>.exe`, the installer
- `Overlay-Setup-<version>.exe.blockmap`, for differential updates
- `latest.yml`, the update manifest the in-app updater reads

Release notes are fixed text: version, build date and the SmartScreen hint. They never include commit
messages, because the releases repo is public.

## How updates reach users

Packaged `release` builds (tagged installs) check `peter-swiatek/overlay-releases` 30 seconds after
start and every 6 hours, using plain HTTPS requests to the public GitHub releases (no token, no user
data). A found update downloads in the background and installs when the app quits; the app never
restarts on its own. The tray menu has **Check for updates**, **Include test builds** and, once an
update is downloaded, **Restart to update (vX.Y.Z)**. Dev and local builds never check
("Updates: release builds only").

- By default only stable releases are offered. Prereleases (`v0.2.0-rc.1`, branch builds
  `v0.1.0-dev.N`) reach only people who tick **Include test builds** in the tray.
- The updater is unsigned-friendly: `app-update.yml` carries no publisher name, so unsigned NSIS
  updates are accepted.

### Pulling a bad release

Delete the release on `overlay-releases`, or edit it and tick "Set as a pre-release"; it is then no
longer offered to normal users. People who already updated stay on the bad version until a newer
release exists, so publish a fixed, higher version (bump the patch and tag again).

## One-time setup of the releases repo

1. Create `peter-swiatek/overlay-releases` (public, releases only, no source). It needs at least one
   commit (a README is enough), because release tags are created from its default branch.
2. Create a fine-grained personal access token with **Contents: read and write** on that repository
   only, and add it to the source repo as the Actions secret `RELEASES_TOKEN`. The workflow's built-in
   `GITHUB_TOKEN` cannot write to another repository, so the secret is always required; the job fails
   early with a clear message if it is missing.
3. Optional: to release somewhere else, set the repository variable `RELEASES_REPO` to `owner/name`.
   It defaults to `peter-swiatek/overlay-releases`. The token must then cover that repository.

## Optional hardening

Put `RELEASES_TOKEN` in a GitHub Environment named `release` instead of a repository secret, with
deployment branch and tag rules that allow only `v*` tags and `main`. Then only those refs can read the
token. The workflow does not require the environment yet; adding `environment: release` to the job is
the only workflow change needed.

## Unsigned installer

The installer is not code-signed. Windows SmartScreen shows "Windows protected your PC" on first run:
click **More info**, then **Run anyway**.

## PR and branch builds

`ci.yml` still builds the installer on every push and pull request and uploads it as an Actions
artifact named `overlay-windows-installer-<version>` (version `<x>-ci.<run>`). Actions artifacts always download as a zip; use a
release for anything you hand to someone else.
