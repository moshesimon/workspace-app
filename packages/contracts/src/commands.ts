import { z } from "zod";
const id = z.string().min(1);
const key = { idempotencyKey: id };
const workspace = { workspaceId: id, checkoutId: id.optional() };
const checkout = { checkoutId: id };
const project = { projectId: id };
export type CommandDefinition = {
  input: z.ZodObject<any>;
  mutation: boolean;
  description: string;
  destructive?: boolean;
};
const query = (
  shape: Record<string, z.ZodType>,
  description: string,
): CommandDefinition => ({
  input: z.object(shape).strict(),
  mutation: false,
  description,
});
const action = (
  shape: Record<string, z.ZodType>,
  description: string,
  destructive = false,
): CommandDefinition => ({
  input: z.object({ ...shape, ...key }).strict(),
  mutation: true,
  description,
  destructive,
});
export const commands = {
  "controller.status": query(
    {},
    "Read local controller protocol and identity.",
  ),
  "projects.discover": query(
    { root: id, depth: z.number().int().min(0).max(12).optional() },
    "Inventory repository evidence in a selected folder; executes no project code.",
  ),
  "projects.register": action(
    { root: id, name: id.optional(), manifest: z.unknown().optional() },
    "Register a project folder and optional portable configuration.",
  ),
  "projects.rebind": action(
    { ...project, root: id },
    "Rebind an unused project to a moved folder without rewriting its portable manifest.",
  ),
  "projects.list": query({}, "List registered projects."),
  "projects.get": query(
    project,
    "Read project repositories and configuration.",
  ),
  "projects.unregister": action(
    project,
    "Unregister an unused project; retain all files.",
  ),
  "configuration.get": query(
    { ...project, revisionId: id.optional() },
    "Read a configuration revision.",
  ),
  "configuration.validate": query(
    { manifest: z.unknown(), root: id.optional() },
    "Validate portable project configuration without running commands.",
  ),
  "configuration.import": action(
    { ...project, manifest: z.unknown() },
    "Import an immutable configuration revision.",
  ),
  "configuration.export": query(
    project,
    "Export secret-free portable configuration.",
  ),
  "configuration.apply": action(
    { workspaceId: id, revisionId: id },
    "Apply a revision to a stopped workspace explicitly.",
  ),
  "repositories.list": query(
    { projectId: id.optional() },
    "List registered repositories.",
  ),
  "repositories.register": action(
    { ...project, key: id, path: id },
    "Register a repository belonging to a project.",
  ),
  "repositories.update": action(
    { repositoryId: id, path: id },
    "Rebind an unused repository path.",
  ),
  "repositories.unregister": action(
    { repositoryId: id },
    "Unregister an unused repository without deleting files.",
  ),
  "repositories.discover": query(
    { repositoryId: id },
    "Inspect existing Git worktrees without assuming ownership.",
  ),
  "workspaces.list": query(
    { projectId: id.optional() },
    "List workspaces and cached runtime state.",
  ),
  "workspaces.get": query(
    { workspaceId: id },
    "Read workspace checkouts, preparation, resources and services.",
  ),
  "workspaces.create": action(
    { ...project, name: id, branch: id.optional(), sourceRef: id.optional() },
    "Create a workspace and linked worktrees; preserve partial successes.",
  ),
  "workspaces.rename": action(
    { workspaceId: id, name: id },
    "Rename a workspace.",
  ),
  "checkouts.create": action(
    {
      workspaceId: id,
      repositoryId: id,
      branch: id,
      sourceRef: id.optional(),
      path: id.optional(),
      existingBranch: z.boolean().optional(),
    },
    "Create or attach a linked worktree and record provenance.",
  ),
  "checkouts.adopt": action(
    { workspaceId: id, repositoryId: id, path: id },
    "Explicitly adopt an existing linked worktree.",
  ),
  "checkouts.get": query(
    checkout,
    "Read immutable checkout provenance and current state.",
  ),
  "changes.list": query(
    checkout,
    "Read staged, unstaged and untracked changes.",
  ),
  "changes.diff": query(
    {
      ...checkout,
      path: z.string(),
      area: z.enum(["staged", "unstaged", "untracked"]),
    },
    "Read a local file diff; never changes Git files.",
  ),
  "history.list": query(
    {
      ...checkout,
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    "Read commit history and commits since recorded base.",
  ),
  "history.commit": query({ ...checkout, commit: id }, "Read a commit diff."),
  "pullRequests.list": query(
    checkout,
    "Inspect all matching GitHub PR states using local gh credentials.",
  ),
  "pullRequests.get": query(
    {
      ...checkout,
      number: z.number().int().positive(),
      repository: id.optional(),
    },
    "Read PR details with consistent head/base identity.",
  ),
  "pullRequests.diff": query(
    {
      ...checkout,
      number: z.number().int().positive(),
      repository: id.optional(),
    },
    "Read the pull request diff, distinct from local changes.",
  ),
  "profiles.list": query(
    project,
    "List service profiles in current project configuration.",
  ),
  "profiles.save": action(
    { ...project, profile: z.unknown() },
    "Save a service profile as a new configuration revision.",
  ),
  "profiles.remove": action(
    { ...project, repository: id, profileId: id },
    "Remove a profile only when unused.",
  ),
  "setup.run": action(
    workspace,
    "Run tracked configuration preparation recipes.",
  ),
  "setup.status": query(
    { workspaceId: id },
    "Read preparation receipts and blockers.",
  ),
  "setup.logs": query(
    {
      receiptId: id,
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100000).optional(),
    },
    "Read bounded redacted preparation logs.",
  ),
  "resources.list": query(
    { workspaceId: id },
    "Read workspace infrastructure ownership and state.",
  ),
  "resources.status": query(
    { resourceId: id },
    "Read one infrastructure resource.",
  ),
  "services.list": query(
    { workspaceId: id },
    "Read assigned and observed service ports and readiness.",
  ),
  "services.logs": query(
    {
      serviceId: id,
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100000).optional(),
    },
    "Read bounded redacted service logs.",
  ),
  "lifecycle.start": action(
    { ...workspace, serviceId: id.optional() },
    "Prepare and start an isolated workspace stack.",
  ),
  "lifecycle.stop": action(
    { ...workspace, serviceId: id.optional() },
    "Stop only verified owned processes and resources; retain data.",
  ),
  "lifecycle.refresh": action(
    workspace,
    "Passively observe Git and runtime; updates cached snapshots.",
  ),
  "destroy.preview": query(
    workspace,
    "Inventory exact worktrees and discarded files; persists an expiring preview.",
  ),
  "destroy.execute": action(
    { previewId: id, discardChanges: z.boolean() },
    "Remove previewed linked worktrees after revalidation, retaining branches.",
    true,
  ),
  "operations.list": query({}, "Read recent operation progress and outcomes."),
  "operations.get": query({ operationId: id }, "Read a persisted operation."),
  "operations.wait": query(
    {
      operationId: id,
      timeoutMs: z.number().int().min(0).max(25000).optional(),
    },
    "Wait for an operation with a bounded timeout.",
  ),
  "integration.status": query(
    {},
    "Read Codex integration state without changing configuration.",
  ),
  "integration.preview": query(
    { action: z.enum(["connect", "disconnect"]) },
    "Preview exact integration file changes and ownership conflicts; caches preview.",
  ),
  "integration.apply": action(
    { previewId: id },
    "Apply a validated preview to Codex configuration and the bundled skill.",
  ),
  "integration.disconnect": action(
    { previewId: id },
    "Remove only unchanged integration files owned by this installation.",
  ),
} satisfies Record<string, CommandDefinition>;
export type CommandName = keyof typeof commands;
export type CommandMap = {
  [K in CommandName]: {
    input: z.infer<(typeof commands)[K]["input"]>;
    output: unknown;
  };
};
export function parseCommand(name: string, input: unknown) {
  if (!(name in commands)) throw new Error(`Unknown command ${name}`);
  return commands[name as CommandName].input.parse(input ?? {}) as Record<
    string,
    any
  >;
}
