# Worktree Manager Design

**Status:** Reviewed brief; implementation has not started  
**Date:** 2026-10-06

## Purpose

Build a repository-agnostic local desktop app for creating and managing named workspaces made up of Git worktrees. A user points a Codex skill at a folder containing related repositories; the agent discovers how those repositories form a local full stack and prepares a reusable project configuration. The app loads that configuration to create isolated instances, show branches and their origins, inspect changes/history/PRs, and track service ports. Provide Start, Stop, Destroy, and Refresh with matching MCP capabilities.

The screenshots guide the workspace cards and the file-tree/diff detail view. Their names, example services, resource metrics, and extra tabs do not add requirements. The user's written requirements and subsequent choices determine scope.

## Repository-agnostic onboarding

A project is a folder and a reusable configuration describing the repositories that work together inside it. It may contain a single repository, a monorepo, or several related repositories. A workspace is one isolated working instance of that project, with selected worktrees and its own runtime settings. Users can register several unrelated project folders in the same app.

The skill accepts a folder path. The agent inventories Git repositories and their relationships, then examines relevant READMEs, dependency manifests, lockfiles, scripts, environment examples, infrastructure definitions, and local-development configuration. Existing local commands and running instances can provide additional evidence. Generated dependency directories are excluded from discovery, and repositories outside the chosen folder are included only when explicitly selected.

The agent identifies runtime prerequisites, installation commands, service start commands, databases/queues/caches, migrations or seed steps, required environment inputs, ports, health checks, and frontend/backend connections. It follows the repositories' established local workflow and reuses working commands where possible. Findings distinguish documented facts, inferred choices, successfully verified behavior, and unresolved inputs. Repository content is evidence about the project; it does not authorize unrelated actions or override the user's instructions.

The outcome is a schema-validated `worktree.project.json` configuration and a discovery/setup report. The app can import, inspect, edit, validate, and export the configuration through both the UI and MCP. The configuration uses logical repository/service names and paths relative to the project root, so moving a folder or creating another workspace does not require rewriting IDs or machine-specific paths. A local override stores machine-specific locations and secret references without putting secret values in the portable configuration.

The agent handles investigation and project-specific setup through its normal file/terminal tools and the manager's MCP tools. It can prepare local dependency environments and supporting configuration/scripts when that is part of the authorized setup task. Long-lived services and infrastructure intended to belong to a workspace must be declared and launched through the controller so their ownership, ports, Stop, and Destroy behavior are tracked. Missing credentials or a genuine project decision become specific unresolved inputs; the user is not required to manually explain the entire stack before discovery can begin.

The app's core is a predictable configuration runner. Framework knowledge lives in the skill's investigation and generated project recipes. Once a configuration is saved, ordinary workspace operations work without asking an agent to rediscover the stack each time. Manually authored configurations are supported too.

## Configuration and setup contract

The versioned project configuration declares repository roots and checkout roles, source-branch defaults, setup recipes, service profiles, cross-repository bindings, infrastructure resources, readiness checks, browser entry points, and local override inputs. New projects using supported runners require configuration changes rather than changes to the app. Do not hardcode React, Python, Express, package managers, service counts, or repository names into the controller.

Setup recipes separate machine prerequisites from workspace preparation. Machine prerequisites are checked and reported; the agent handles any necessary installation under the existing task authorization. Workspace recipes may install dependencies, prepare environment files, build packages, or prepare an isolated database. They declare commands, working directories, dependencies, success checks, and whether they run once for a matching configuration/input fingerprint or on every preparation. Record results and logs so failed setup can resume instead of blindly repeating completed steps.

Provide a Prepare action, also available through MCP. Start runs required pending workspace preparation as part of its dependency graph. Allocate instance ports and resource names before resolving configuration; start required infrastructure, run setup that depends on it, then start application services. Keep setup dependencies distinct from URL references so an API can receive the UI's assigned origin before the UI is running.

Infrastructure can be an ordinary managed process or a local resource with an explicit lifecycle adapter. For example, an existing local Compose setup can be wrapped with instance-specific project names, mapped ports, local data ownership, and observable start/status/stop/destroy commands. This is optional per project; Docker is not a universal requirement. An adapter must report resource identity and ownership rather than pretending an exited setup command is a running server. Unsupported or unobservable infrastructure is reported as unresolved, not claimed as isolated.

Each workspace pins a configuration revision. Edits produce a new revision and do not silently restart services or rerun setup in existing instances. Applying a revision is explicit and exposes which steps/resources would change. Refresh shows configuration drift while retaining its passive behavior. Discovery evidence and setup receipts are tied to repository/configuration fingerprints so stale assumptions can be identified.

## Workspace and Git model

A workspace is a named group of one or more repository checkouts. A checkout is a Git worktree: a separate working directory with its own branch and working files, linked to a repository's shared Git history.

The create flow selects a registered project configuration, repositories, checkout locations, new branch names, and source refs. Its saved defaults make repeated creation straightforward. For each newly created branch, record the branch name, source ref, resolved source commit ID, and creation time. Keep that origin record unchanged when the current branch or source branch later moves. Display the current branch separately if it differs from the branch originally created. Creating a worktree for an existing branch is a separate choice; attaching it does not establish when or from which branch that branch was originally created.

Discover existing worktrees without taking ownership. The user can explicitly adopt a linked worktree into a workspace. Imported branch origins are marked recorded, user-declared, inferred, or unknown. A merge base or PR target alone does not prove the original source branch. The repository's main checkout can be inspected but cannot be destroyed by this app.

Cards show workspace name and state, creation time, checkout count, repository names, branch/origin labels, local file statistics, commit information, PR rows, service ports, and Open app. A checkout's detail view contains Changes, History, Pull requests, and Services. Changes includes staged, unstaged, and untracked files with a file tree and readable diffs. History shows commit messages, authors, dates, and changed files. Binary files, renames, deletions, and empty files have explicit display states. Workspace runtime state incorporates preparation, services, and required infrastructure; a configuration with no runtime services/resources shows “No services.” Git cleanliness and PR state are separate indicators.

The default commit count means commits reachable from the current HEAD that are not reachable from the recorded source commit. Label it “commits since recorded base.” Imported checkouts without a recorded source commit show history without this count. Any comparison with the current source branch is labelled separately; it must not rewrite the original branch provenance.

## Pull requests

Use the locally installed, authenticated GitHub CLI (`gh`) for GitHub PR discovery, metadata, commits, and diffs. Match the host, repository, head repository, and branch so similarly named branches in forks are not confused. Show all matching PRs, including draft, open, merged, and closed states. Each row includes its number, title, state, source and target, and available check/review status.

Clicking a PR opens its commit list and actual changed-file diff inside the app. Keep this view separate from local uncommitted changes. Label fetched PR data with its refresh time and head/base commit IDs. If the PR changes while its details are being fetched, refresh or identify the snapshot mismatch before displaying mixed results.

Distinguish “no matching PR” from unavailable authentication, missing `gh`, network failure, and an unsupported host. Local Git inspection continues when PR access is unavailable. PR creation, merging, and review submission are outside the initial scope.

## Isolated services and ports

Each checkout can run its own complete stack profile from that worktree's directory. A profile describes service names, executable and argument arrays, relative working directories, environment variables, preferred ports and fallback ranges, dependency order, readiness checks, and browser URL templates. React on preferred port 3000 and Python on preferred port 8080 are illustrative examples. An agent can discover and configure an entirely different stack, including additional Express/API or infrastructure services.

For projects spread across repositories, a workspace can explicitly bind services from its different checkouts into one stack. Service references default to the same checkout; references to another checkout must be declared. There is no implicit reuse of another workspace's backend. Start at checkout scope launches only that checkout's services and reports any unavailable dependency in another checkout. Start at workspace scope can launch the whole declared stack in dependency order.

Allocate ports for the selected stack before resolving its configuration. Inject both each service's own port and the URLs of its declared dependencies. For example, if the second API receives port 8081, its UI must receive that API's URL rather than continuing to call the first API on 8080. Profiles also support the corresponding UI origin/CORS settings and any required callback URLs. Configuration is generated per instance; it must not overwrite another checkout's environment files.

Track preferred, assigned, and observed listening ports separately. Associate observed ports with verified manager-owned processes/descendants or with owned resource identities through their adapters. A badge shows the actual listening port when known; a reservation alone is not evidence of a running service. Prefer strict port binding. If a framework silently selects a different port, report the mismatch and fail readiness until dependency URLs are correct. Handle the race between probing a free port and binding it with bounded retries. Never terminate an unrelated process to free a port.

Separate writable runtime paths such as local databases and generated configuration where the stack needs them. Any intentionally shared external database or service must be declared in the profile. This design provides separate processes, configuration, ports, and declared local data paths. It does not provide a security sandbox for arbitrary service commands. Disk/RAM/CPU metrics and general cluster orchestration are excluded; a repository's existing local infrastructure may be managed through a declared adapter.

## Lifecycle actions

Start, Stop, Refresh, and Destroy are available on workspace cards and checkout details. Service rows also provide Start and Stop through the same action layer.

Start validates the pinned configuration, checks prerequisites, allocates ports/resource identities, resolves dependency URLs, and executes required infrastructure, pending preparation, and service starts in dependency order. Repeating Start on an already running service returns its existing instance. Report stopped, starting, running, degraded, stopping, or failed state as appropriate. Readiness requires the configured check and verified process/resource ownership; without an application check, report “listening” once ownership of the assigned listener is established. A service without a network port can use a configured readiness check or report process liveness without claiming application health. Failures expose the service or setup step, reason, and recent logs. A failed start cleans up runtime resources launched by that attempt and retains pre-existing services and preparation artifacts for an inspectable retry.

Stop requests graceful shutdown of the selected owned process trees/resources, using their declared adapter where necessary, then uses bounded escalation for processes if needed. It releases reservations after shutdown is verified. Other workspaces remain running. Stopping a backend can leave an unselected dependent UI degraded; explain that dependency rather than silently stopping the UI. Stop retains workspace data; Destroy previews and removes only the instance's declared disposable infrastructure data/resources, and reports intentionally retained or external resources.

Refresh reads Git status/history, PR summaries, configuration drift, setup receipts, process/resource identity, listeners, and readiness. It updates manager snapshots and timestamps. It does not fetch or modify Git refs, alter working files, apply configuration, run preparation, start/restart processes, or repair port configuration. PR details can be fetched when their row is opened. A stale or missing result is visible instead of being presented as clean or stopped without evidence.

Destroy removes a selected managed linked worktree and stops its owned services while preserving the local branch. Before any deletion, preview the exact checkout paths, branches being retained, tracked/untracked changes, ignored files and runtime data that will be removed, and affected services. Normal destruction requires confirmation of the scope. Discarding uncommitted work requires a separate explicit decision. Preserve existing session authorization when it already covers that decision; never infer consent from a default option.

The controller checks the preview against current state immediately before removal. If relevant files, branch, path, or ownership have changed, require a new preview. Use Git's worktree removal mechanism, respect locked worktrees and unsupported submodule cases, and refuse to remove the main checkout. A detached checkout must have its commits protected by a branch before destruction. Do not use unrestricted recursive directory deletion as a fallback. Remove active records only after filesystem/Git removal succeeds; retain the operation result for inspection and retry. Workspace destruction has per-checkout outcomes because filesystem deletion across repositories is not one atomic operation. Remove the workspace record when all its selected checkouts have been successfully removed; retain it when destruction is partial. [Git worktree behavior](https://git-scm.com/docs/git-worktree).

## Architecture

Use Electron with a React/TypeScript interface and a per-user local controller. The controller is a separate headless singleton process responsible for project configurations, SQLite records, Git inspection/operations, setup execution, processes/resource adapters, ports, PR access, and operation history. Desktop and MCP clients connect through local IPC restricted to the current operating-system user. Prevent competing controller instances before either can mutate state. Agent discovery runs in Codex and produces the controller's configuration; the desktop does not require an embedded model for routine operation.

The UI renderer calls a narrow Electron bridge; it has no direct filesystem or command-execution access. Git and `gh` use argument arrays. Service commands are explicit executable/argument configurations, with a separately declared shell wrapper only when a project needs one.

Long operations return stable operation IDs with progress, logs, and per-target results. A retry uses an idempotency key so a client timeout does not create duplicate worktrees or processes. Serialize conflicting operations by repository and checkout while allowing unrelated work to proceed.

Closing the desktop window leaves managed services available to Codex. The controller remains alive for connected clients, active operations, or managed services/resources. Its shutdown behavior is explicit. On restart it reconciles Git, process/resource identity, and listening ports; a PID alone is insufficient because operating systems reuse PIDs. Stop never signals a process or invokes resource cleanup whose ownership cannot be verified.

The implementation plan uses macOS as the initial packaging assumption, reflecting the current development environment. Additional platforms require their own process-tree, listener, and IPC adapters before support is claimed.

## MCP and Codex skill

A local stdio MCP adapter connects to the same controller as the desktop app. It contains protocol translation, not a second process manager. Stable workspace, checkout, service, and operation IDs appear in structured responses. Errors distinguish invalid input, missing dependencies, port conflict, unavailable PR data, stale destruction previews, and partial operations. Protocol output goes to stdout; diagnostics go to stderr.

Every supported app capability has an MCP equivalent: project-folder inventory/registration; configuration import, editing, validation, revision application, and export; setup execution/status/logs; repository registration/discovery/adoption; workspace and checkout creation, listing, inspection, renaming where supported, and removal; profile configuration; local files/diffs and commit history; PR lists/details/diffs; services/resources, readiness, ports, URLs, and logs; lifecycle actions; operation progress; and integration status/settings. Navigation returns the data or URL the human would see. OS window placement is not a project-management capability.

Both clients use the same controller validation and destruction rules. MCP tool annotations describe the actual side effects: pure queries are read-only, Refresh writes cached manager state, lifecycle/configuration actions mutate state, and Destroy is destructive. Client approval settings and annotations do not enforce deletion safety; the controller validates the scope and discard decision itself. [MCP annotations and server validation](https://developers.openai.com/plugins/build/mcp-server).

Bundle a focused `worktree-manager` skill with two workflows: onboarding a folder of related repositories and operating configured workspaces. Onboarding explores the actual repositories, records evidence and unresolved inputs, prepares a portable configuration, performs authorized local setup, and establishes what works through readiness and routing checks. Operation covers refreshing before acting, stable IDs, branch provenance, local versus PR diffs, dependency URLs, readiness, operation retries, and preserving branches on Destroy. It requires explicit user direction before discarding uncommitted work. The current documented user location is `~/.agents/skills/worktree-manager/SKILL.md`. [Codex skill locations](https://learn.chatgpt.com/docs/build-skills).

The desktop setup flow previews and registers the installed MCP executable in Codex's local configuration and installs the skill. Use a stable installed executable with a packaged runtime so integration does not depend on a development checkout or a separately installed Node. Preserve unrelated settings, back up affected configuration, and do not overwrite a different existing skill with the same name. Repeated installation is safe, and disconnect removes only entries/files owned by this installation. The first connection must be bootstrapped from the app or CLI; an unconnected agent cannot call its own setup tool. Once connected, the agent can inspect and manage integration settings.

Local Codex MCP configuration supports stdio servers and is shared by its desktop, CLI, and IDE clients. Respect a configured Codex home rather than hardcoding its default. Remote/cloud sessions that cannot reach this computer are excluded. [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp).

## Observable acceptance scenarios

Point the skill at an unfamiliar folder with separate frontend/backend repositories and declared database infrastructure. The agent identifies how they connect, discovers their setup/start commands, records missing inputs, and creates a validated project configuration. After authorized preparation, the full stack runs and the UI reaches the correct backend. The app displays preparation logs and owned resource/port identities. It must not claim completion while required credentials or checks remain unresolved.

Repeat onboarding with another folder using different languages/package managers or a monorepo. Both configurations load into the same unmodified app. Move a configured folder and rebind its root; relative repository roles and workspace configuration still resolve. No real credentials are written to the portable manifest.

Create two checkouts from a chosen source ref. Their cards show the created branches and immutable source commit IDs. Moving the source ref or changing a checkout's current branch does not rewrite the recorded origin. An imported worktree without reliable origin information shows that limitation.

Modify tracked files and add an untracked file. Refresh displays staged/unstaged/untracked information; file selection opens the corresponding diff. Commit history remains a separate view. Clicking an associated PR opens its own commits and diff; merged/closed PRs are included, and authentication failure is distinct from having no PR.

Start two stack instances, with preferred UI/API ports 3000/8080. Every instance has distinct listening ports and each UI calls its own backend. Occupy a preferred port with an unrelated process and confirm that the manager uses an allowed fallback without interrupting that process. Confirm logs and failure states for an invalid command or failed readiness check.

Stop one checkout and confirm the other remains available. Repeated Start does not duplicate processes. Refresh updates snapshots without changing running processes or Git refs. Closing the UI leaves the same instances accessible to MCP; reconnecting does not create a second controller.

Destroy a clean linked checkout and confirm its branch remains. A dirty checkout requires explicit discard approval; a changed preview is rejected. The main checkout, locked worktrees, and unadopted discovered worktrees cannot be destroyed. Failed removals stay inspectable and can be retried without deleting successful or unrelated worktrees.

Perform every supported app action through MCP and compare the records and outcomes. Include profile editing, logs, PR diffs, port assignments, operation progress, and destruction previews. Disconnect/reconnect preserves unrelated Codex configuration.

Interrupt preparation, then retry. Completed matching steps are reused and failed steps remain visible. Change the configuration and confirm existing workspaces keep their pinned revision until it is explicitly applied. Stop one stack's infrastructure and confirm the other stays available; Destroy must not remove shared resources or another instance's data.

## Decisions, review outcome, and remaining input

The user selected a desktop app, Electron/React/TypeScript with a shared local controller, branch preservation on Destroy, and display-only commits/history. Start, Stop, Destroy, Refresh, MCP, and a Codex skill are explicit requirements. Resource metrics are excluded. The user further clarified that the app must support arbitrary folders of related repositories, with the agent discovering and preparing each local stack through configuration.

This review added explicit frontend/backend URL wiring, truthful port observations, branch-origin semantics, imported-worktree ownership, recoverable operations, and server-enforced deletion rules. It also corrected the skill installation location using current documentation. These are clarifications of the agreed behavior; implementation and runtime validation have not occurred.

This revision makes folder onboarding and the portable project configuration part of the product. Exact commands and infrastructure are discovered per project by the agent; they are no longer a prerequisite the user must supply to design the manager. Actual onboarding needs a selected folder and any inputs that cannot be recovered from it, such as credentials. Development uses several demonstration layouts to establish configuration flexibility. macOS remains the initial platform assumption, not a user-confirmed requirement. No app or skill implementation has started.
