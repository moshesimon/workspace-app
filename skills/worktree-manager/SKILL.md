---
name: worktree-manager
description: Use when onboarding a folder of Git repositories into Worktree Manager or operating its configured workspaces, services, local changes, and pull requests through the worktree-manager MCP server.
---

Use the `worktree-manager` MCP server to manage the same projects and instances shown in the desktop app. Tools use underscores in place of command dots, for example `workspaces_create` and `lifecycle_start`. Obtain IDs from tool results rather than filenames or display names.

For a new project folder, read [onboarding](references/onboarding.md) and the [configuration contract](references/project-configuration.md). Discover the actual repositories, setup commands, services, infrastructure, and connections from project evidence. Produce a portable configuration and a report of evidence, verified behavior, and unresolved inputs. Host prerequisites and project-specific investigation use normal agent tools; long-lived workspace services/resources launch through the manager.

For an existing workspace, use `projects_list`, `workspaces_list`, and `workspaces_get` to select its stable IDs. Refresh before reporting current Git/runtime state. `lifecycle_refresh` observes and updates snapshots; it does not fetch Git refs, prepare files, change revisions, or restart services. A workspace pins its configuration revision. Import edits as a new revision and apply them explicitly to a stopped workspace.

Mutations require a fresh `idempotencyKey`. They return an operation ID: wait with `operations_wait` or inspect `operations_get` until succeeded, partial, or failed. Reuse the same key when retrying the same request; inspect per-target outcomes before retrying partial work.

Typical creation/start: register a validated manifest, call `workspaces_create` with projectId/name/branch/sourceRef, then `setup_run` and `lifecycle_start` with workspaceId. Inspect setup receipts/logs and observed service ports/readiness. Assigned ports alone do not prove readiness; verify frontend-to-backend routing for the intended instance. Missing secrets are specific blockers, never success.

For changes, use `changes_list` and `changes_diff`. Use `history_list` for commits since recorded base: the recorded source commit stays fixed when source refs move. Adopted/existing branches can have unknown origins. For PR inspection, use `pullRequests_list`, then `pullRequests_get` or `pullRequests_diff` with checkoutId, number, and the returned repository. PR diffs are remote snapshots, separate from local uncommitted changes; report unavailable or mismatched snapshots accurately.

Stop with `lifecycle_stop`; retained workspace data and other instances remain available. For Destroy, call `destroy_preview`, report exact checkout/data scope and retained branches, and obtain direct user authorization for that scope. Discarding uncommitted or ignored content needs an explicit discard decision. Preserve authorization already given in the conversation. Call `destroy_execute` with previewId and that decision; a stale preview needs renewed inspection. Discovered/main checkouts and unverified processes are protected.
