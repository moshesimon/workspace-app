# Grove — Worktree Manager

A macOS desktop demo for managing Git workspaces and isolated local stacks. Electron/React desktop, one SQLite-backed local controller, and matching MCP tools.

## Try the demo

```sh
npm install
npm run package:mac
npm run demo:launch
```

The last command creates disposable demo repositories under `work/demo`, starts **Checkout redesign** and **API sandbox**, checks that each UI reaches its own API and data service, and opens the packaged desktop. It uses separate demo state in `work/demo-state`. No Codex configuration is changed.

Cards provide Start, Stop, Refresh, Destroy and Open app. Click a workspace name for local changes/diffs, history, PRs, services, preparation and logs. Stop retains data. Destroy previews discarded files and retains Git branches.

The packaged app is `release/mac-arm64/Worktree Manager.app`. You can open it directly for an empty personal workspace list. Copy it to Applications before connecting Codex through Settings. The current build is unsigned and intended for a local demo.

## Use your projects

Add a folder containing one or more Git repositories. Import or edit a `worktree.project.json` manifest in Project Configuration. A project without runtime services supports Git inspection immediately. The bundled [onboarding skill](skills/worktree-manager/SKILL.md) helps an agent investigate actual setup commands and produce a manifest; the application itself does not infer arbitrary frameworks.

Configuration revisions are immutable. Stop a workspace before applying a revision. Changing an existing owned infrastructure definition may require a new workspace; existing data is retained. A moved project can be rebound while it has no active workspaces.

Prerequisites are Git and whatever the managed project declares (Node, Python, Docker, etc.). `gh` is optional: missing or unauthenticated GitHub CLI produces an explicit unavailable state without blocking local Git. Secret values use `{{secret.NAME}}` references resolved from the controller's local environment; they are redacted from logs.

## Development and verification

Development was verified on macOS arm64 with Node 22.22; Node 24 is recommended. The packaged Electron 44 runtime includes Node 24.21, so the installed manager does not require system Node. Managed projects still need their declared runtimes.

```sh
npm run dev                 # build and launch development desktop
npm run check               # TypeScript and source tests
npm run package:mac         # build the unsigned app bundle
npm run verify:packaged     # concurrent real stdio MCP clients + SQLite handshake
npm run verify:desktop      # actual packaged create/close/reopen desktop flow
```

Focused checks: `verify:configuration`, `verify:git`, `verify:setup`, `verify:resources`, `verify:services`, `verify:lifecycle`, `verify:github`, `verify:runtime`, `verify:parity`, `verify:integration`. Tests use disposable repositories and settings. Integration verification never modifies your actual Codex setup.

## Architecture

- `packages/contracts`: validated configuration and the shared command registry.
- `packages/controller`: SQLite, journaled operations, Git, preparation, resource/process ownership, lifecycle and integration.
- `packages/client`: private Unix socket connection, singleton startup and client liveness.
- `packages/mcp`: typed tools generated from the same registry used by Electron.
- `apps/desktop`: isolated renderer, narrow preload and desktop/controller/MCP modes.

Personal state defaults to `~/Library/Application Support/Worktree Manager`. Set `WORKTREE_MANAGER_HOME` for an isolated state directory. Closing the window leaves services running in the controller. Restart reconciliation uses recorded Git intents and process identities, never a PID alone. Logs and operation results remain available for inspection.

## Demo boundaries

This is a working demo, not a finished release of every acceptance item in the original plan. Live GitHub authentication, real-project onboarding, Compose adapters, signing/notarization and other operating systems have not been verified. Setup commands currently have a bounded execution timeout and interrupted preparation is marked failed rather than automatically resumed; use short demonstrable setup recipes. Typed command-backed infrastructure hooks are trusted project code, not a sandbox.

The implementation progress and outstanding acceptance items are recorded in [the execution plan](2026-10-06-worktree-manager-execplan.md). No repository commits or PR writes are exposed by the manager.
