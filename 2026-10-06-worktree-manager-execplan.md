# Build a desktop worktree manager with matching MCP capabilities


This ExecPlan is a living document. Update Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective whenever implementation changes or stops. The user requested the format in [OpenAI's ExecPlan guide](https://developers.openai.com/cookbook/articles/codex_exec_plans); this file contains the necessary product and implementation context itself. This is a proposed implementation plan, not evidence of a built application.


## Purpose / Big Picture


A developer will point a Codex skill at a folder containing related repositories. The agent will investigate how the local full stack works, prepare its setup commands and infrastructure configuration, and save a reusable project manifest. The repository-agnostic desktop app will load that manifest to create named workspaces, inspect branches/changes/history/PRs, and run isolated stack instances. Start, Stop, Refresh, Destroy, configuration, and preparation will be available through both the app and local MCP. Destroy retains Git branches.

Demonstrate onboarding for several unfamiliar repository layouts, then run two isolated instances of one project. Each UI must call its own API despite alternate port assignments, and any managed database/infrastructure must have its own declared instance identity. A developer can stop or destroy one without affecting the other and can perform the same supported operations from local Codex with the desktop window closed. Disk/RAM/CPU metrics, creating commits, PR writes, cloud workspaces, and general cluster orchestration are excluded. Existing local infrastructure such as Compose can be integrated through configuration and a lifecycle adapter; it is not mandatory for every project.


## Progress


- [x] (2026-10-06) Capture the user's desktop, architecture, commit-display, lifecycle, branch-preservation, MCP, and skill decisions.
- [x] (2026-10-06) Review the design brief and clarify dependency URLs, port observations, branch provenance, import ownership, and deletion validation.
- [x] (2026-10-06) Write this implementation plan. No application code or runtime verification has been performed.
- [x] (2026-10-06) Incorporate repository-agnostic folder onboarding, agent-led setup, portable configuration, preparation receipts, and infrastructure adapters.
- [ ] Milestone 1: Establish the packaged runtime, shared controller, contracts, and local connection.
- [ ] Milestone 2: Deliver project-folder inventory, portable configuration, and the agent onboarding contract.
- [ ] Milestone 3: Deliver repository/worktree creation and Git inspection.
- [ ] Milestone 4: Deliver preparation, isolated services/resources, ports, and logs.
- [ ] Milestone 5: Deliver recoverable lifecycle operations and branch-preserving destruction.
- [ ] Milestone 6: Deliver project configuration screens, workspace cards, detail screens, and PR inspection.
- [ ] Milestone 7: Deliver complete MCP parity, the Codex skill, reversible installation, and the packaged walkthrough.


## Surprises & Discoveries


Review finding: unique ports do not ensure the UI uses the correct backend. Each instance must resolve its dependency URLs after port allocation. Evidence: the proposed example has APIs preferring 8080, so a second instance needs a different API URL as well as a different port.

Review finding: a Git worktree does not provide a trustworthy historical source-branch record by itself. Store the selected source ref and resolved commit during creation; label imported origins honestly. Existing-branch attachment must not be labelled as branch creation.

Documentation finding: the current documented user skill directory is `~/.agents/skills`. MCP annotations help clients choose approval behavior but do not replace server validation. The design therefore keeps destruction checks in the controller. These are documentation/design findings; no runtime experiment has occurred.

Scope clarification: the user wants the agent to discover each project's commands and infrastructure from a selected folder. Requiring the user to supply a complete React/Python startup profile first would miss that workflow. Discovery and preparation are now part of the skill and configuration contract. The manager's own Electron/TypeScript implementation does not constrain the languages used by managed projects.


## Decision Log


Decision (2026-10-06, user): deliver a local desktop app using Electron and a React/TypeScript interface with a shared local controller. Rationale: the user chose this architecture, and both the app and local agents need to control the same services.

Decision (2026-10-06, user): show history and changes without creating Git commits. Preserve local branches during Destroy. Rationale: these were explicit answers to scope questions.

Decision (2026-10-06, review): services belong to checkouts; a workspace may explicitly connect services across its own checkouts. Rationale: support a complete stack in one repository and a stack split across repositories without silently connecting to another workspace.

Decision (2026-10-06, planning assumption): package macOS first, with operating-system adapters separated for later ports. Rationale: the current development environment is macOS; additional platform support has not been requested or confirmed.

Decision (2026-10-06, planning): use one installed Electron executable with desktop, controller, and MCP modes. Controller/MCP modes open no windows and run in separate processes. Rationale: supply a runtime that works without system Node while preserving a controller independent of the UI. Prove this packaging arrangement in Milestone 1 before building dependent features.

Decision (2026-10-06, planning): npm workspaces, TypeScript, React, Vite, SQLite through `better-sqlite3`, and the official MCP TypeScript server package. Rationale: keep common contracts in one language and persistent state in one local database. Pin resolved stable dependency versions in the lockfile at bootstrap; rebuild native SQLite against the packaged Electron runtime.

Decision (2026-10-06, user clarification): support a selected folder of collaborating repositories, with the agent investigating and preparing the local stack. Rationale: the product should adapt through configuration rather than requiring a particular repository layout or application framework.

Decision (2026-10-06, planning): use a versioned `worktree.project.json` manifest with relative repository paths and logical names, plus local overrides and immutable workspace configuration revisions. Rationale: make agent-produced and manually edited configurations portable and prevent an edit from silently changing running instances.

Decision (2026-10-06, planning): keep project-specific investigation and host installation in the agent workflow; put repeatable workspace preparation and long-lived resource ownership in the controller. Rationale: preserve flexible setup while keeping runtime status, ports, Stop, and Destroy consistent across GUI and MCP. Allow a typed command-backed resource adapter for existing local infrastructure instead of adding framework-specific branches to the controller.


## Outcomes & Retrospective


Planning outcome: the revised product includes agent-led folder onboarding and a reusable project recipe, followed by the existing worktree/lifecycle/PR capabilities. Implementation remains entirely outstanding. Commands, runtime prerequisites, and infrastructure will be discovered per project; they are not information the user must supply in advance to design the manager. Actual onboarding still needs a selected folder and unresolved inputs such as credentials. Use multiple demonstration layouts during development. macOS remains a stated packaging assumption.


## Context and Orientation


The current folder, `/Users/moshesimon/Documents/Codex/2026-10-06/new-chat-3`, contains planning deliverables rather than an application repository. The reviewed companion brief is `outputs/2026-10-06-worktree-manager-design.md`. Create the eventual product in a new `worktree-manager/` repository under the current folder, or use a repository the user supplies before implementation. All implementation paths below are relative to that product root. Do not create application files or install Codex configuration during this planning turn.

A repository contains shared Git history. A linked worktree is another working directory attached to it, with its own current branch and file state. A checkout is the manager's record for that worktree. A project is a selected folder plus a configuration of cooperating repositories; a workspace is one working instance using that configuration and selected checkouts. A service is a configured UI/API/other process. A resource is local infrastructure with declared ownership and lifecycle, such as an instance-specific database. A setup recipe is a finite preparation command and success check, rather than a long-lived server. A profile describes services; a project manifest binds profiles, repositories, setup, and resources. A controller is the headless local process owning all operations. IPC means local messages between processes. MCP translates agent calls into controller calls; stdio uses its process's stdin/stdout as the protocol connection.

Use Node 24 LTS for development commands and npm for the workspace. The installed application uses Electron's bundled runtime. Git is required; `gh` is optional for GitHub features. Detect missing commands with actionable errors. Profiles must declare any Python, Node, package installation, or other prerequisites needed by the target stack; the manager must not pretend those dependencies exist.

Create `apps/desktop/src/main.ts` as the runtime mode dispatcher, `preload.ts` as the limited renderer bridge, and `renderer/` as the React interface. Create `packages/contracts/src/` for validated records and command schemas; `packages/controller/src/` for persistence and handlers; `packages/client/src/` for local IPC; and `packages/mcp/src/` for protocol translation. Separate `packages/controller/src/projects/`, `setup/`, `resources/`, `git/`, `services/`, `operations/`, `github/`, and `integration/` by responsibility. Put the skill in `skills/worktree-manager/SKILL.md`, its configuration/onboarding references in `skills/worktree-manager/references/`, and fixtures in `fixtures/demo-stack/`, `fixtures/multi-repo/`, and `fixtures/monorepo/`. The two latter layouts deliberately use different scripts/dependency arrangements to expose hardcoded assumptions.

Create root `package.json`, `package-lock.json`, `tsconfig.json`, and packaging configuration. Root scripts must include `dev`, `build`, `check`, `package:mac`, `demo:prepare`, and the milestone verification commands described below. The verification commands are proposed for later implementation validation; none was run while reviewing this brief.


## Interfaces and Dependencies


Define `Project`, `ProjectConfiguration`, `ConfigurationRevision`, `DiscoveryReport`, `SetupRecipe`, `SetupReceipt`, `RuntimeResource`, `Repository`, `Workspace`, `Checkout`, `ServiceProfile`, `ServiceInstance`, `Operation`, `DestroyPreview`, and `IntegrationPreview` in `packages/contracts/src/models.ts`. Use UUIDs as stable database IDs. A Project stores its root path and logical-repository bindings; Workspace stores `projectId` and a pinned `configurationRevisionId`. Resolve paths to canonical absolute paths before storing them. A Checkout stores `repositoryId`, `workspaceId`, `path`, `ownership` (discovered/created/adopted), `createdBranch`, `currentBranch`, `sourceRef`, `sourceCommit`, `originEvidence`, `createdAt`, and `registeredAt`. A discovered checkout has no workspace until adopted. Nullable origin/creation fields are legitimate for imported or existing branches; registration time does not prove branch creation time. Refresh updates current state without modifying the creation record.

Define the version-1 portable manifest schema in `packages/contracts/src/project-configuration.ts`. Its root fields are `schemaVersion`, `name`, `repositories`, `prerequisites`, `setup`, `services`, `resources`, `bindings`, and `entrypoints`. Repositories use logical keys, project-relative paths, and optional source-ref defaults; executable arguments and environment/URL templates are data. Execution dependencies use typed logical references (`setup:<id>`, `resource:<id>`, `service:<repository-key>/<id>`) to prevent name collisions. No persisted UUID, real secret, or absolute home path belongs in the portable manifest. Resolve logical references into current workspace IDs at instantiation. Local overrides bind prerequisite locations and secret references to the selected machine. Generate immutable configuration revisions from the manifest plus resolved nonsecret inputs; do not mutate a running workspace when a newer revision is imported.

A DiscoveryReport records selected root, repository evidence (path/file fingerprints), documented/inferred/verified findings, and unresolved questions. A SetupRecipe has `id`, logical repository scope, executable/arguments, cwd/environment templates, explicit dependencies, a read-only success probe, and `runPolicy` (`oncePerInputs` or `always`). Prerequisite/status probes must also be read-only and bounded by timeouts. A SetupReceipt stores recipe/configuration/input fingerprints, workspace scope, state, timestamps, and log references. Successful matching receipts may be reused; a failed or interrupted step is never recorded as complete. Resolve secret inputs locally and retain only nonreversible fingerprints where change detection requires them.

Define `RuntimeAdapter` in `packages/controller/src/resources/adapter.ts` with `start(context): Promise<ResourceHandle>`, `inspect(handle): Promise<ResourceStatus>`, `stop(handle): Promise<void>`, and `destroy(handle, preview): Promise<void>`. Context includes workspace/checkout identity, configuration revision, assigned ports, environment, and a generated resource namespace. Handles/status include adapter kind, namespace, concrete resource identity, ownership evidence, observed ports, state, and retained/disposable data paths. Implement ordinary process resources and a command-backed adapter whose named start/status/stop/destroy hooks exchange validated JSON. Hooks are explicit trusted project code; they are not a security sandbox. They must identify resources within the expected namespace, and unverified ownership blocks cleanup. The skill can generate a wrapper for an existing local Compose/database tool without framework-specific code in the app.

A ServiceProfile contains executable/argument arrays, a relative working directory, environment templates, declared worktree-relative runtime paths, dependencies, readiness policy, and optionally a preferred port/range. Support `{{workspace.id}}`, `{{checkout.path}}`, `{{self.port}}`, `{{self.url}}`, `{{service.api.url}}`, and `{{resource.db.url}}` for instance-specific values. Create declared local runtime paths without following a symlink outside their allowed root. Portable bindings use logical repository/service keys, resolved to IDs in the current workspace. Validate references and reject execution-order cycles; URL references alone do not imply start-order edges. A ServiceInstance stores resolved configuration, preferred/assigned/observed ports, PID plus start identity, process group, state, readiness evidence, timestamps, and logs. Redact declared secrets and never echo the complete environment. Workspace runtime state incorporates required services/resources/setup; Git and PR states remain separate.

An Operation contains `id`, `idempotencyKey`, action/scope, status (queued/running/succeeded/partial/failed), timestamps, and per-target outcomes. A DestroyPreview contains its ID, expiry, exact target IDs/paths, retained branches, removal inventory, warnings, and state fingerprints. Confirmation names a preview ID and a separate discard decision. A changed or incomplete inventory cannot authorize removal.

Define a `CommandMap` in `packages/contracts/src/commands.ts`, including input and output schemas for every supported action. The shared entry point is:

    call<K extends keyof CommandMap>(name: K, input: CommandMap[K]["input"]):
      Promise<CommandMap[K]["output"]>

The controller dispatches this map. Electron and MCP use `ControllerClient.call` rather than duplicating implementations. Queries return structured records and timestamps. Actions affecting projects, runtime, or installed configuration return an Operation, with progress obtained through `operations.get` and `operations.wait`. Preview calls return their preview records directly; declare any cache writes in their tool annotations. An IntegrationPreview includes exact planned file/setting changes, ownership conflicts, and current configuration fingerprints. Keep waits bounded and resumable. Every mutation accepts an idempotency key; reusing it with different input is an error.

Cover `controller.status`, `projects.discover/register/list/get/unregister`, `configuration.get/validate/import/export/apply`, `setup.run/status/logs`, `resources.list/status`, `repositories.list/register/update/unregister/discover`, `workspaces.list/create/get/rename`, `checkouts.create/adopt/get`, `changes.list/diff`, `history.list/commit`, `pullRequests.list/get/diff`, `profiles.list/save/remove`, `services.list/logs`, `lifecycle.start/stop/refresh`, `destroy.preview/execute`, `operations.get/wait`, and `integration.status/preview/apply/disconnect`. Controller status returns protocol version and process identity. Project/repository unregister removes only registration and refuses active references. Profile removal refuses while in use. Workspace/checkout removal goes through Destroy. Setup runs a named recipe from a validated configuration revision; no arbitrary renderer shell-execution or path-deletion endpoint is exposed. Agents use their normal authorized file/terminal tools for investigation and host setup.

Use SQLite tables `projects`, `configuration_revisions`, `discovery_reports`, `setup_receipts`, `runtime_resources`, `repositories`, `workspaces`, `checkouts`, `profiles`, `service_instances`, `port_reservations`, `operations`, `destroy_previews`, and `integration_installs`. Apply versioned migrations transactionally. Only the controller writes product state. Back up the database before an irreversible schema migration. Define domain errors in `packages/contracts/src/errors.ts`, including `INVALID_INPUT`, `NOT_MANAGED`, `PORT_CONFLICT`, `DEPENDENCY_UNAVAILABLE`, `SETUP_INPUT_REQUIRED`, `UNSUPPORTED_SCHEMA_VERSION`, `CONFIGURATION_CHANGED`, `PR_UNAVAILABLE`, `STALE_PREVIEW`, `OPERATION_CONFLICT`, and `OWNERSHIP_UNVERIFIED`.


## Plan of Work


### Milestone 1: Shared runtime and packaged headless connection


Create the workspace and contracts above. Implement `startController()` in `packages/controller/src/server.ts` and `connectOrStart()` in `packages/client/src/connect.ts`. Establish the basic persisted operation store in `packages/controller/src/operations/store.ts` and scoped locks in `packages/controller/src/operations/locks.ts` here so later worktree and service actions can journal intent immediately. Use a Unix-domain socket inside a short, per-user private directory, owner-only permissions, and a protocol-version handshake. Use atomic lock acquisition with recorded process identity so simultaneous UI/MCP startup produces one controller. Never remove a supposedly stale lock/socket until its owner is proven absent. Keep the database in the user's application-data directory, with a separate isolated directory for development/verification.

In `apps/desktop/src/main.ts`, dispatch `--mode=desktop`, `--mode=controller`, or `--mode=mcp` before creating any window. Only desktop mode creates a BrowserWindow. Launch controller mode detached from the desktop/MCP lifetime; retain it while clients, operations, or owned services/resources exist, then use a short idle grace period before shutdown. Start MCP mode with inherited protocol pipes and diagnostic stderr. Package this arrangement immediately. If the packaged headless mode cannot initialize SQLite, remain alive, or keep stdout free of runtime diagnostics, resolve the packaging problem here rather than proceeding with a development-only substitute.

Deliver an empty desktop connected to controller status, backed by SQLite, and a minimal MCP status query. With verification authorized, run `npm run verify:runtime`. Expected evidence is one controller identity returned by concurrent clients, no windows opened by controller/MCP modes, and a successful protocol handshake from the packaged executable. Also run `npm run package:mac` and launch its generated app normally. Record the actual package path and native-module build results.


### Milestone 2: Project inventory, configuration, and agent onboarding


Implement `discoverProjectFolder(root, options): Promise<DiscoveryReport>` in `packages/controller/src/projects/discovery.ts`. It inventories Git roots, including a root that is itself a repository, multiple child repositories, and existing linked worktrees. Deduplicate shared repository identity without dropping distinct worktree paths. Default traversal skips `.git`, dependency/build directories, and symlinks escaping the selected root; expose include/exclude and depth overrides. Report unreadable/truncated discovery explicitly. Discovery is a bounded inventory, not a promise that the app understands every framework.

Implement `validateConfiguration(manifest, root)`, `importConfiguration(projectId, manifest)`, `exportConfiguration(projectId)`, and `applyConfiguration(workspaceId, revisionId)` in `projects/configuration.ts`. Validate schema version, logical references, contained paths, required input references, runner support, and the combined resource/setup/service execution graph. Missing secrets remain unresolved inputs, never guessed values. Import produces a revision and evidence rather than creating worktrees or executing commands. Applying a revision to a running instance reports required changes and refuses implicit restart; the user/agent can Stop, explicitly apply, then Prepare/Start. Rebinding a moved root does not require changing relative manifest paths.

Write `skills/worktree-manager/references/onboarding.md` and `project-configuration.md` as the contract for the later skill entrypoint. The agent examines relevant README/setup guides, manifests/lockfiles, scripts, environment examples, service clients, and infrastructure definitions. It records where commands/dependency connections came from, resolves logical repository roles, and produces a draft manifest and missing-input report. It follows actual project evidence rather than selecting a canned React/Python template. It performs authorized host/project setup through normal tools and uses MCP for configuration and tracked workspace preparation/runtime. Discovery does not expand authorization for unrelated/global or external changes. Add the new project/configuration commands to the minimal MCP adapter so onboarding can register its results before the full parity milestone.

Define `fixtures/multi-repo/` with two collaborating repositories and a declared local data service, plus `fixtures/monorepo/` with different package/script names and a service needing no network port. Keep expected reports out of the skill's input. With verification authorized, run `npm run verify:configuration` to check inventory, schema/path/reference errors, moves, secret-free export, revision pinning, and graph validation. A later real-agent exercise supplies the fixture folder to the skill and evaluates its discovered recipe against observable operation; parser tests alone do not establish the skill's discovery quality.


### Milestone 3: Worktrees, provenance, and local Git inspection


Implement `registerRepository`, `discoverWorktrees`, `createCheckout`, and `adoptCheckout` in `packages/controller/src/git/worktrees.ts`. Use `git worktree list --porcelain -z` to discover paths and branch state. Validate branch names, canonical paths, repository identity, and main-versus-linked ownership. For a new path, resolve its existing parent before appending the validated final directory name. Resolve the chosen source with `git rev-parse --verify --end-of-options <ref>^{commit}` and store the result before creation. Create a new branch using `git worktree add -b <branch> <path> <resolved-commit>`. Attach an existing branch explicitly without resetting it. Refuse branch/path conflicts rather than forcing them.

Journal creation intent before launching Git, then inspect its result before committing the checkout record. On recovery, compare repository, path, branch, and operation intent to detect a worktree created before a controller crash. Do not adopt a coincidentally matching external directory. A multi-repository workspace reports each result and permits retry of failed targets without rolling back successful edited checkouts.

In `git/changes.ts`, read machine-readable status and separate index/staged changes, tracked worktree changes, and untracked content. Supply text hunks for each area, explicit binary/large-file states, rename information, and safe path containment. In `git/history.ts`, implement paginated log and per-commit diffs. Count `sourceCommit..HEAD` only when a source commit was recorded; show another label for any live-base comparison. Treat detached HEAD, missing source refs, and unavailable history as visible states.

With verification authorized, run `npm run verify:git` against fresh disposable fixture repositories. Observe two new branches with unchanged origin records after advancing the source ref, correct staged/unstaged/untracked displays, existing-branch attachment without fabricated provenance, and refusal of occupied paths/branches. Include filenames with spaces, Unicode, and newline characters. Product methods must leave repository content unmodified during inspection.


### Milestone 4: Preparation, service isolation, infrastructure, and ports


Implement `resolveProfile` in `services/profiles.ts`, `allocatePorts` in `services/ports.ts`, `startServices`/`stopServices` in `services/processes.ts`, and platform inspection in `services/platform/macos.ts`. Implement prerequisite checks and preparation in `setup/runner.ts`, receipt handling in `setup/receipts.ts`, and process/command resource adapters in `resources/process.ts` and `resources/command.ts`. Validate prerequisite executables, working directories, templates, execution cycles, and shared-data declarations. Report a missing host prerequisite to the agent rather than silently installing it through Start. Normal workspace recipe commands are configured, tracked operations with logs; they do not require the user to handwrite every step when the skill can discover it.

Reserve all selected service/resource ports and instance namespaces before configuration resolution. Default demonstration fallback ranges are UI 3000–3099 and API 8080–8179; real profiles override them. Probe bind availability, persist the plan, and resolve URLs/environment values. Run the execution graph: start required infrastructure, run setup requiring that infrastructure, then start dependent applications. A URL reference alone creates no start-order edge, such as API CORS settings using the future UI origin.

Prepare through `setup.run` or the pending-preparation portion of Start. Reuse only successful receipts whose recipe, configuration, relevant repository inputs, and resolved input fingerprints match. An `always` recipe runs each time preparation is requested. If a step fails, retain its logs/artifacts and specific blocker, mark dependents blocked, and stop newly launched runtime owned by that attempt; do not roll back user edits or already completed preparation. Recheck success probes before claiming setup is ready after a restart. Changing assigned ports invalidates any preparation receipt that embedded those ports.

For command-managed infrastructure, require status hooks to return validated resource identity, expected namespace, actual published ports, health, and data ownership. A detached launcher exiting zero is not readiness. A project using Compose receives distinct project names and data/port bindings for each instance; a project using a foreground database can use the process adapter. No resource is implicitly shared. Explicit external/shared resources are observed as dependencies and excluded from Stop/Destroy. Exercise command-adapter mechanics with a self-contained fixture; a live Compose exercise additionally requires the relevant installed tool and a selected project.

Start process groups rooted in the selected checkout, capture stdout/stderr to bounded per-service logs, and retain identity beyond the parent PID. Inspect sockets with the platform adapter and attribute all observed listening ports to verified descendants, including incidental development-server ports. HTTP health checks alone cannot prove ownership. Retry binding conflicts up to three times, recomputing URLs for services launched by that attempt; preserve pre-existing healthy instances. A server that silently changes its assigned port fails readiness until configuration is consistent. Stop gracefully, allow five seconds, then escalate only for verified owned groups and confirm socket release.

The basic demo fixture contains a small UI/API pair. The API returns a unique workspace/checkout marker; the UI displays the marker from its configured API. Preferred ports are 3000/8080. The multi-repo fixture adds independent local data/resource identities, and the monorepo fixture uses another command/layout convention. All run through configuration on the same controller. No real project's commands are hardcoded into the manager.

With verification authorized, run `npm run verify:setup`, `npm run verify:resources`, and `npm run verify:services`. Observe resumable preparation, invalidated input fingerprints, explicit missing inputs, distinct resource/data identities, and two correctly wired UI/API pairs. Preserve unrelated port occupants and pre-existing processes; show failure logs without exposing secret inputs. Confirm extra listeners appear, a mismatched port is not labelled ready, a detached resource needs observable ownership/health, and a reused PID is never signalled.


### Milestone 5: Operations, Refresh, recovery, and Destroy


Extend the operation store and scoped locks from Milestone 1 with retry/recovery handling; implement reconciliation in `operations/refresh.ts` and destruction in `operations/destroy.ts`. Workspace operations aggregate per-target results. Start/Stop at checkout scope must not implicitly start/stop services in another checkout; report dependency effects. Refresh observes Git, configuration drift, setup receipts, resource identity, processes, and ports without applying a revision, preparing files, starting/stopping anything, or changing Git refs.

`previewDestroy(scope)` inventories exact paths, retained branches, owned resources, and retained/disposable data before side effects. Include tracked, staged, untracked, ignored, and runtime content that removal would discard. Large declared disposable runtime directories may be summarised with their deletion scope explicit. Never silently omit unknown ignored user files. List external/shared resources as retained. Detached checkouts need their commits protected by a branch before destruction.

`executeDestroy({previewId, discardChanges, idempotencyKey})` verifies managed/adopted linked-worktree ownership, scope consent, dirty-data consent, lock/submodule restrictions, and inventory state. Stop affected services, then recheck relevant file and Git state immediately before removal. Known disposable runtime directories are identified as such in the preview, so their log churn does not hide changes to user files. If the state changed, return `STALE_PREVIEW`; never silently broaden discard consent. Use `git worktree remove` normally and a single force flag only for the previewed discard case. Do not unlock or double-force locked trees, remove the main checkout, delete branches, or fall back to recursive deletion. External editors cannot be locked by the controller; document that rechecking reduces the race without promising atomic deletion against arbitrary concurrent writers.

On failure, retain active records and the partial operation. On success, mark the checkout removed and retain an operation tombstone. Remove a workspace's active record only after all its checkouts are successfully removed; preserve its partial state otherwise. If Git succeeded before a database update was interrupted, recovery must prove the known path and Git registration are absent before completing the record. Repeating a completed destruction returns its prior outcome. A failed workspace removal does not trigger removal of other unrelated checkouts.

Stop retains owned data and invokes the selected resource's stop adapter in reverse dependency order. Destroy invokes resource cleanup only for previewed, verified, disposable ownership; it must not use a broad infrastructure prune or remove shared volumes/data. Track resource cleanup and Git removal as separate per-target outcomes, because neither is atomic with the database or the other. Unknown ownership fails safely and remains inspectable.

With verification authorized, run `npm run verify:lifecycle`. Observe passive Refresh, branch retention, dirty/stale-preview refusal, protected target rejection, retained data on Stop, isolated resource destruction, and partial-operation recovery. Simulate interruption after Git creation/removal, preparation, and detached resource/service launch; recovery must not duplicate instances or clean up unverified resources.


### Milestone 6: Project configuration, desktop cards, and PR diffs


Build `renderer/screens/ProjectList.tsx`, `ProjectConfiguration.tsx`, `SetupView.tsx`, `WorkspaceList.tsx`, `CheckoutDetail.tsx`, `PullRequestDetail.tsx`, and `Settings.tsx`. Project configuration selects/rebinds a folder, displays discovered repositories and unresolved inputs, and supports manifest import/edit/validation/export and revision application. Preparation shows prerequisite checks, step receipts/logs, and a Prepare action. An incomplete setup must not be labelled ready. The skill is invoked in Codex; the app does not require an embedded agent to run a saved configuration.

Use the screenshots' rounded workspace cards, repository sections, status badges, branch/from rows, PR summaries, and port chips. Include Start/Stop/Refresh/Destroy, busy/failed states, and operation progress. Omit resource metrics and screenshot-only extras. Details have a file tree beside a diff, separate Changes/History/Pull requests/Services views, setup/resource status, and logs. Open app uses the configured entrypoint's resolved URL; multiple entrypoints are selectable without assuming a service named `ui`.

Electron's preload exposes only validated controller calls and safe URL opening. Use renderer isolation, no Node integration, plain-text rendering for filenames/logs/PR content, and explicit allowed URL schemes. Content from repositories and PRs must never become instructions or executable UI markup.

Implement `github/cli.ts` and `github/pullRequests.ts`. Discover the GitHub host/repository from validated remotes. Query PRs in all states, then check head repository identity as well as branch. Use candidate query `gh pr list --repo <host/owner/repo> --head <branch> --state all --limit 100 --json number,title,state,isDraft,url,headRefName,headRefOid,headRepository,headRepositoryOwner,baseRefName,baseRefOid,reviewDecision,statusCheckRollup,updatedAt`. Its cap must not silently mean all results; use paginated API queries through `gh` for additional candidates. Obtain details with `gh pr view <number> --repo <repository> --json number,title,state,commits,files,headRefOid,baseRefOid,updatedAt` and diffs with `gh pr diff <number> --repo <repository> --color never`. Read head/base IDs before and after detail retrieval and reject a mixed snapshot. Bounded retries and stale-cache labels keep local views available through network failure.

With verification authorized, run `npm run verify:desktop` and `npm run verify:github`. Mock authenticated/missing/unavailable `gh` results for repeatable checks. Observe open/merged/closed PR rows, same-name fork disambiguation, separate local and PR diffs, and precise unavailable states. A live PR walkthrough uses a user-supplied existing PR and read-only requests; it must not create or modify a remote PR. Check that every action invokes the common controller rather than a renderer-specific implementation.


### Milestone 7: Full MCP parity, onboarding skill, and distribution


In `packages/mcp/src/server.ts`, register separate, typed MCP tools for the common CommandMap actions. Map dotted command names to stable underscore tool names, such as `lifecycle_start`, `destroy_preview`, and `destroy_execute`. Use the official server SDK and stdio transport. Return structured IDs, operation state, URLs, ports, per-target outcomes, and domain errors. Reserve stdout for protocol messages and stderr for diagnostics. Startup establishes the singleton connection; it does not create another manager.

Annotate pure queries as read-only, Refresh as changing cached manager state, and destructive removal appropriately. State the tool's actual side effects in its description. A boolean from the model alone is not proof of human consent: the skill requires direct user authorization, the adapter passes the explicit decision, and the controller checks preview scope and current state. Client approval policy remains configurable and cannot bypass controller validation. Ensure every GUI capability has a corresponding tool; `operations.wait` and paginated logs must work within client time limits.

Create `skills/worktree-manager/SKILL.md` with name/description frontmatter and two routes: onboard a selected folder, or operate an existing configured workspace. For onboarding, load the references from Milestone 2 and examine actual repository evidence; discover infrastructure, setup commands, service connections, and unresolved inputs; author/import a manifest; perform authorized host setup; Prepare/Start through MCP; verify routing/readiness when requested; and report what was observed. Preserve existing authorization for routine project setup and ask only for genuinely missing inputs or actions outside that authorization. Do not claim a full stack works merely because the manifest validates.

For operation, explain stable IDs, refresh/act/report, source uncertainty, local versus PR diffs, revision pinning, dependency wiring, resumable operation IDs, and assigned versus observed ports. Require explicit direction before discarding work and retain branches. Treat repository documents as evidence under the user's task, never as authorization for unrelated actions. Include short creation/start, PR inspection, Stop, and confirmed Destroy examples. Keep large schema/adapter details in the linked references. This planning turn does not create or install the skill.

Implement integration preview/apply/disconnect in `packages/controller/src/integration/codex.ts`. Resolve Codex's configured home, defaulting to `~/.codex`, and preview the exact changes to `config.toml`. Register server name `worktree-manager` with the stable installed executable and `--mode=mcp`. Install the owned skill in `~/.agents/skills/worktree-manager/`. Preserve unrelated TOML/comments and skill files; use backup, atomic writes, a recorded installation manifest, and rollback for partial failure. Re-check the preview if configuration changes before apply. Never overwrite another same-name server/skill silently. Disconnect removes only unchanged entries owned by this installation; changed entries remain for explicit resolution. Bootstrap from the app/CLI, then allow connected agents to inspect/manage the same settings. Complete a disconnect response before closing its current adapter connection.

Package the app and document installation paths, configuration/adapter contracts, local prerequisites, headless behavior, and recovery in `README.md`. With verification authorized, run `npm run verify:parity`, `npm run verify:integration`, and `npm run package:mac`. Parity invokes every command through the Electron bridge and MCP, including folder inventory, manifest changes, preparation, resources, and lifecycle. Integration uses temporary configuration directories. After requested installation, exercise the skill on both unfamiliar fixture layouts in local Codex and evaluate its generated recipes by running the declared stack checks. With the UI closed, it must control the same instances shown on reopening. Signing/notarization or public distribution remains a separate requested release action.


## Concrete Steps


During implementation, choose the product root described above and establish the workspace files and scripts in Milestone 1. Run development commands from that root. Initial environment inspection is:

    pwd
    node --version
    npm --version
    git --version
    gh --version

`node --version` should report development Node 24.x. Missing `gh` is a supported product condition; missing Git prevents worktree creation. After writing manifests, install dependencies and produce the lockfile with `npm install`; subsequent installs use `npm ci`.

After the scripts exist, build and open the desktop with:

    npm run build
    npm run dev

The expected result is a desktop connected to one local controller. `npm run demo:prepare -- --root work/demo` creates disposable demonstration project folders and prints their absolute paths without modifying existing projects. Point the skill at a folder to discover/import its configuration, or import a fixture manifest through the app. Create two workspaces/branches and Prepare/Start their declared stacks. Fixture creation must refuse an existing non-fixture target.

For a later authorized verification pass, run:

    npm run check
    npm run verify:runtime
    npm run verify:configuration
    npm run verify:git
    npm run verify:setup
    npm run verify:resources
    npm run verify:services
    npm run verify:lifecycle
    npm run verify:github
    npm run verify:desktop
    npm run verify:parity
    npm run verify:integration
    npm run package:mac

Each verification command uses temporary Git/config/state directories, returns nonzero on a failed assertion, and prints concise scenario results. Native process/port checks run on macOS. The packaged runtime check must exercise the actual executable; a development-only pass cannot satisfy it. Record actual command output in Artifacts and Notes when these checks are performed. Do not claim these commands exist or passed before implementation creates and runs them.


## Validation and Acceptance


Acceptance is the behavior in all seven milestones, followed by a combined walkthrough. Start with an unfamiliar folder of collaborating repositories: the skill must identify setup commands and infrastructure from evidence, import a portable configuration, report unresolved inputs, and perform authorized setup without requiring the user to describe the whole stack. Repeat with a different framework/layout on the same unmodified application. Rebind a moved folder and confirm relative repository roles still resolve. Runtime verification and inferred configuration must be labelled separately.

Create two branches from a named source ref and confirm their recorded source IDs remain fixed. Edit a file and confirm local diff/history separation. Open an existing PR and inspect its actual changed files; then remove authentication and observe a specific unavailable state rather than “no PR.”

Start both demo stacks and inspect each UI's marker. Both markers must correspond to the intended checkout, with distinct verified listener ports. Stop one and confirm the other responds. Refresh must preserve process identities and Git refs. Close/reopen the UI while using MCP and confirm stable service/operation IDs and one controller.

Preview Destroy and see precisely what is retained and removed. A clean removal preserves its branch. Dirty removal needs explicit discard authorization; changing a relevant file invalidates the preview. Protected/unmanaged targets are refused, and interrupted operations remain recoverable. Reproduce the whole supported app workflow through MCP, including profiles, diffs, logs, and operation progress.

Interrupt preparation and retry; reuse successful matching receipts, surface failed steps, and preserve files for inspection. Start two instances with owned infrastructure and confirm independent resource names/data and correct dependency routing. Stop retains data; Destroy removes only the declared instance's disposable data. Import a changed configuration and confirm existing instances retain their revision until explicitly changed. Missing credentials stay blocked rather than being treated as setup success.

For a real selected project folder, have the skill discover its actual stack and repeat these checks with its generated configuration. Fixtures establish the manager's contracts; compatibility with that actual project is established only through its own observed setup/readiness/routing results.


## Idempotence and Recovery


Persist operation intent before irreversible side effects. Retries with the same key and input return the existing operation; changed input produces an error. Restart reconciliation checks Git registrations and verified process identities rather than trusting cached state. Database migrations and integration writes have backups and atomic replacement. Keep failed/partial records until their actual outcome is established.

A lifecycle failure exposes logs and per-target results. It never deletes a branch, kills an unrelated process, resets an existing branch, or recursively erases an unknown path. If ownership cannot be proved, report it and require fresh inspection. Shared repository refs and same-checkout operations use ordered locks to avoid UI/MCP races. Locks do not control external editors or Git commands; revalidation immediately before side effects is required.

Verification fixtures must be clearly marked and isolated. Clean up only resources created by the current fixture run. Never reuse the user's real repository, database, Codex settings, or service processes as destructive fixtures.


## Artifacts and Notes


Current artifacts are this plan and the revised brief. Future evidence should include discovery reports and portable manifests for different repository layouts, setup receipts/blockers, isolated resource identities, a packaged-runtime handshake, branch/source records, two-instance URL/marker output, local/PR diff screenshots, retained branches after removal, stale-preview refusal, and parity covering every CommandMap action. Leave clear which observations have actually occurred.

For provenance, the current documentation confirms [local Codex stdio configuration](https://learn.chatgpt.com/docs/extend/mcp), [user skill discovery](https://learn.chatgpt.com/docs/build-skills), and [MCP annotations' limits](https://developers.openai.com/plugins/build/mcp-server). The plan's integration behavior above is explicit so execution does not depend on those pages. The [MCP server guide](https://modelcontextprotocol.io/docs/develop/build-server) supplies the current TypeScript server package and stdout rule. Electron's [process model](https://www.electronjs.org/docs/latest/tutorial/process-model), [renderer security guidance](https://www.electronjs.org/docs/latest/tutorial/security), and [native-module guidance](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) support the packaging prototype; the actual prototype remains unperformed. Node 24 is listed as LTS in the [Node release table](https://nodejs.org/en/about/previous-releases). Git and GitHub command behavior was checked against [git-worktree](https://git-scm.com/docs/git-worktree), [gh pr list](https://cli.github.com/manual/gh_pr_list), [gh pr view](https://cli.github.com/manual/gh_pr_view), and [gh pr diff](https://cli.github.com/manual/gh_pr_diff).
