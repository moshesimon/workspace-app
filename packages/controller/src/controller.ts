import { randomUUID } from "node:crypto";
import { canonicalNew, resolveCommit } from "./git/command.js";
import { reconcileGit } from "./operations/recovery.js";
import { mkdir, realpath } from "node:fs/promises";
import { join, basename, relative } from "node:path";
import {
  commands,
  parseCommand,
  type CommandName,
} from "../../contracts/src/commands.js";
import { DomainError, errorRecord } from "../../contracts/src/errors.js";
import type {
  Project,
  Repository,
  Workspace,
  Checkout,
  ConfigurationRevision,
  DestroyPreview,
} from "../../contracts/src/models.js";
import { Store } from "./store.js";
import { OperationStore } from "./operations/store.js";
import { discoverProjectFolder } from "./projects/discovery.js";
import {
  validateConfiguration,
  importConfiguration,
  exportConfiguration,
  containedRepository,
} from "./projects/configuration.js";
import {
  registerRepository,
  discoverWorktrees,
  createCheckout,
  adoptCheckout,
  currentBranch,
} from "./git/worktrees.js";
import { readChanges, readDiff } from "./git/changes.js";
import { readHistory, readCommit } from "./git/history.js";
import { inspectDestroy, removeCheckout } from "./git/destroy.js";
import { listPullRequests, readPullRequest } from "./github/pullRequests.js";
import { RuntimeManager } from "./services/runtime.js";
import { CodexIntegration } from "./integration/codex.js";
const now = () => new Date().toISOString();
export class Controller {
  readonly store: Store;
  readonly operations: OperationStore;
  readonly runtime: RuntimeManager;
  readonly integration: CodexIntegration;
  readonly startedAt = now();
  private recovery: Promise<void>;
  constructor(
    public stateRoot: string,
    options: {
      executable?: string;
      skillRoot?: string;
      codexHome?: string;
      agentsHome?: string;
    } = {},
  ) {
    this.store = new Store(stateRoot);
    this.operations = new OperationStore(this.store);
    this.runtime = new RuntimeManager(this.store, stateRoot);
    this.integration = new CodexIntegration(this.store, options);
    this.recovery = reconcileGit(this.store);
  }
  close() {
    this.store.close();
  }
  get isIdle() {
    return (
      this.operations.active === 0 &&
      !this.store
        .all("service_instances")
        .some((s) =>
          [
            "running",
            "starting",
            "listening",
            "degraded",
            "unknown",
            "stopping",
          ].includes(s.state),
        ) &&
      !this.store
        .all("runtime_resources")
        .some((s) => ["running", "starting", "unknown"].includes(s.state))
    );
  }
  private get<T>(table: string, id: string): T {
    const result = this.store.get<T>(table, id);
    if (!result)
      throw new DomainError(
        "INVALID_INPUT",
        `${table} record not found: ${id}`,
      );
    return result;
  }
  private checkouts(id: string) {
    return this.store
      .all<Checkout>("checkouts")
      .filter((c) => c.workspaceId === id && !c.removedAt);
  }
  private workspace(id: string) {
    const w = this.get<Workspace>("workspaces", id);
    if (w.removedAt)
      throw new DomainError("NOT_MANAGED", "Workspace was removed");
    return w;
  }
  private revision(w: Workspace) {
    return this.get<ConfigurationRevision>(
      "configuration_revisions",
      w.configurationRevisionId,
    );
  }
  async call(name: string, raw: unknown = {}) {
    await this.recovery;
    let input: Record<string, any>;
    try {
      input = parseCommand(name, raw);
    } catch (e) {
      throw new DomainError(
        "INVALID_INPUT",
        e instanceof Error ? e.message : String(e),
      );
    }
    const definition = commands[name as CommandName];
    if (definition.mutation)
      return this.operations.run(name, input, () => this.dispatch(name, input));
    return this.dispatch(name, input);
  }
  private async snapshot(id: string) {
    const workspace = this.workspace(id);
    return {
      workspace,
      checkouts: this.checkouts(id),
      services: this.runtime.listServices(id),
      resources: this.runtime.listResources(id),
      setup: this.runtime.listSetup(id),
      project: this.get<Project>("projects", workspace.projectId),
      configuration: this.revision(workspace),
    };
  }
  private async createProject(i: any) {
    const root = await realpath(i.root);
    if (this.store.all<Project>("projects").some((p) => p.root === root))
      throw new DomainError(
        "INVALID_INPUT",
        "This project folder is already registered",
      );
    const report = await discoverProjectFolder(root);
    if (!report.repositories.length)
      throw new DomainError(
        "INVALID_INPUT",
        "No Git repositories found in selected folder",
      );
    const project: Project = {
      id: randomUUID(),
      name: i.name ?? i.manifest?.name ?? basename(root),
      root,
      configurationRevisionId: "",
      createdAt: now(),
    };
    const manifest = i.manifest ?? {
      schemaVersion: 1,
      name: project.name,
      repositories: report.repositories.map((r: any, n: number) => ({
        key:
          (basename(r.path)
            .replace(/[^A-Za-z0-9_-]/g, "-")
            .replace(/^[^a-zA-Z]+/, "") || "repo") +
          "-" +
          (n + 1),
        path: relative(root, r.path) || ".",
      })),
    };
    await importConfiguration(this.store, project, manifest);
    return this.dispatch("projects.get", { projectId: project.id });
  }
  private async createWorkspace(i: any) {
    const project = this.get<Project>("projects", i.projectId);
    const revision = this.get<ConfigurationRevision>(
      "configuration_revisions",
      project.configurationRevisionId,
    );
    const workspace: Workspace = {
      id: randomUUID(),
      projectId: project.id,
      name: i.name,
      configurationRevisionId: revision.id,
      state: "stopped",
      createdAt: now(),
    };
    this.store.put("workspaces", workspace);
    const outcomes: any[] = [];
    for (const entry of revision.manifest.repositories) {
      try {
        const repo = this.store
          .all<Repository>("repositories")
          .find((r) => r.projectId === project.id && r.key === entry.key)!;
        const checkout = await this.newCheckout({
          workspaceId: workspace.id,
          repositoryId: repo.id,
          branch:
            i.branch ??
            `worktree/${i.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${workspace.id.slice(0, 6)}`,
          sourceRef: i.sourceRef ?? entry.sourceRef ?? "HEAD",
        });
        outcomes.push({
          repository: entry.key,
          status: "succeeded",
          checkoutId: checkout.id,
        });
      } catch (error) {
        outcomes.push({
          repository: entry.key,
          status: "failed",
          error: errorRecord(error),
        });
      }
    }
    workspace.state = outcomes.some((o) => o.status === "failed")
      ? "partial"
      : revision.manifest.services.length || revision.manifest.resources.length
        ? "stopped"
        : "no-services";
    this.store.put("workspaces", workspace);
    return {
      ...(await this.snapshot(workspace.id)),
      partial: workspace.state === "partial",
      outcomes,
    };
  }
  private async newCheckout(i: any) {
    const workspace = this.workspace(i.workspaceId);
    const repo = this.get<Repository>("repositories", i.repositoryId);
    if (repo.projectId !== workspace.projectId)
      throw new DomainError(
        "INVALID_INPUT",
        "Repository belongs to another project",
      );
    if (this.checkouts(workspace.id).some((c) => c.repositoryId === repo.id))
      throw new DomainError(
        "INVALID_INPUT",
        "Workspace already has this repository",
      );
    const parent = join(this.stateRoot, "checkouts", workspace.id);
    await mkdir(parent, { recursive: true });
    const path = await canonicalNew(i.path ?? join(parent, repo.key));
    const sourceRef = i.sourceRef ?? "HEAD";
    const commit = await resolveCommit(
      repo.path,
      i.existingBranch ? "refs/heads/" + i.branch : sourceRef,
    );
    const intent: Checkout = {
      id: randomUUID(),
      workspaceId: workspace.id,
      repositoryId: repo.id,
      repositoryKey: repo.key,
      path,
      ownership: "created",
      createdBranch: i.existingBranch ? null : i.branch,
      currentBranch: i.branch,
      sourceRef: i.existingBranch ? null : sourceRef,
      sourceCommit: i.existingBranch ? null : commit,
      originEvidence: i.existingBranch ? "unknown" : "recorded",
      createdAt: now(),
      registeredAt: now(),
      state: "creating",
      creationIntent: { path, branch: i.branch, sourceCommit: commit },
    };
    this.store.put("checkouts", intent);
    try {
      const created = await createCheckout({
        repository: repo,
        workspaceId: workspace.id,
        path,
        branch: i.branch,
        sourceRef: commit,
        existingBranch: i.existingBranch,
      });
      const checkout = {
        ...created,
        id: intent.id,
        sourceRef: intent.sourceRef,
        sourceCommit: intent.sourceCommit,
        creationIntent: intent.creationIntent,
        state: "ready",
      };
      this.store.put("checkouts", checkout);
      return checkout;
    } catch (error) {
      intent.state = "creation-failed";
      intent.creationError = errorRecord(error);
      this.store.put("checkouts", intent);
      throw error;
    }
  }
  private async refresh(i: any) {
    const workspace = this.workspace(i.workspaceId);
    for (const checkout of this.checkouts(workspace.id).filter(
      (c) => !i.checkoutId || c.id === i.checkoutId,
    )) {
      try {
        checkout.currentBranch = await currentBranch(checkout.path);
        checkout.changes = await readChanges(checkout.path);
        checkout.history = await readHistory(
          checkout.path,
          checkout.sourceCommit,
          1,
          0,
        );
        checkout.pullRequests = await listPullRequests(
          checkout.path,
          checkout.currentBranch,
        );
        checkout.refreshedAt = now();
        delete checkout.refreshError;
      } catch (error) {
        checkout.refreshError = errorRecord(error);
      }
      this.store.put("checkouts", checkout);
    }
    await this.runtime.refresh(workspace.id);
    const services = this.runtime.listServices(workspace.id),
      resources = this.runtime.listResources(workspace.id);
    const states = [...services, ...resources].map((s) => s.state);
    workspace.state =
      !this.revision(workspace).manifest.services.length &&
      !this.revision(workspace).manifest.resources.length
        ? "no-services"
        : states.some((s) => ["failed", "degraded", "unknown"].includes(s))
          ? "degraded"
          : states.length &&
              states.every((s) =>
                ["running", "listening", "ready", "external"].includes(s),
              )
            ? "running"
            : "stopped";
    workspace.configurationDrift =
      workspace.configurationRevisionId !==
      this.get<Project>("projects", workspace.projectId)
        .configurationRevisionId;
    workspace.refreshedAt = now();
    this.store.put("workspaces", workspace);
    return this.snapshot(workspace.id);
  }
  private disposablePaths(c: Checkout) {
    const manifest = this.revision(this.workspace(c.workspaceId)).manifest;
    return [
      ...new Set([
        ...manifest.resources
          .filter(
            (r) => r.repository === c.repositoryKey && r.adapter !== "external",
          )
          .flatMap((r) => r.disposablePaths),
        ...manifest.services
          .filter((r) => r.repository === c.repositoryKey)
          .flatMap((r) => r.runtimePaths),
      ]),
    ];
  }
  private async preview(i: any) {
    const workspace = this.workspace(i.workspaceId);
    const selected = this.checkouts(workspace.id).filter(
      (c) => !i.checkoutId || c.id === i.checkoutId,
    );
    if (!selected.length)
      throw new DomainError("INVALID_INPUT", "No matching checkouts");
    const targets = [];
    for (const c of selected)
      targets.push(
        await inspectDestroy(
          c,
          this.get<Repository>("repositories", c.repositoryId),
          this.disposablePaths(c),
        ),
      );
    const resources = this.runtime
      .listResources(workspace.id)
      .filter((r) => !i.checkoutId || r.checkoutId === i.checkoutId)
      .map((r) => ({
        id: r.id,
        identity: r.identity,
        namespace: r.namespace,
        disposablePaths: r.disposablePaths ?? r.dataPaths ?? [],
        ownership: r.ownership,
        adapter: r.adapter,
      }));
    const p: DestroyPreview = {
      id: randomUUID(),
      workspaceId: workspace.id,
      checkoutId: i.checkoutId,
      expiresAt: new Date(Date.now() + 5 * 60000).toISOString(),
      targets,
      resources,
      services: this.runtime
        .listServices(workspace.id)
        .filter((s) => !i.checkoutId || s.checkoutId === i.checkoutId),
      warnings: [
        "Branches are retained. Files listed below are removed. Concurrent external edits cannot be locked by the manager.",
      ],
      retainedBranches: targets
        .map((t) => t.branch)
        .filter(Boolean) as string[],
    };
    this.store.put("destroy_previews", p);
    return p;
  }
  private async destroy(i: any) {
    const p = this.get<DestroyPreview>("destroy_previews", i.previewId);
    if (Date.parse(p.expiresAt) < Date.now() || p.usedAt)
      throw new DomainError(
        "STALE_PREVIEW",
        "Destroy preview expired or already used",
      );
    for (const target of p.targets) {
      const c = this.get<Checkout>("checkouts", target.checkoutId);
      const current = await inspectDestroy(
        c,
        this.get<Repository>("repositories", c.repositoryId),
        this.disposablePaths(c),
      );
      if (current.fingerprint !== target.fingerprint)
        throw new DomainError("STALE_PREVIEW", "Files changed since preview");
      if (current.dirty && !i.discardChanges)
        throw new DomainError(
          "DIRTY_CHECKOUT",
          "Explicit discard decision is required",
        );
    }
    await this.runtime.stop(p.workspaceId, p.checkoutId);
    const outcomes: any[] = [];
    try {
      const result = await this.runtime.destroy(p.workspaceId, p.checkoutId, p);
      outcomes.push({ target: "resources", status: "succeeded", result });
    } catch (error) {
      return {
        partial: true,
        outcomes: [
          { target: "resources", status: "failed", error: errorRecord(error) },
        ],
        retainedBranches: p.retainedBranches,
      };
    }

    for (const target of p.targets) {
      try {
        const c = this.get<Checkout>("checkouts", target.checkoutId);
        c.removalIntent = { path: c.path, previewId: p.id, at: now() };
        this.store.put("checkouts", c);
        const result = await removeCheckout(
          c,
          this.get<Repository>("repositories", c.repositoryId),
          target.fingerprint,
          i.discardChanges,
          this.disposablePaths(c),
        );
        c.removedAt = now();
        this.store.put("checkouts", c);
        outcomes.push({ status: "succeeded", ...result });
      } catch (error) {
        outcomes.push({
          checkoutId: target.checkoutId,
          status: "failed",
          error: errorRecord(error),
        });
      }
    }

    if (
      !this.checkouts(p.workspaceId).length &&
      outcomes.every((o) => o.status === "succeeded")
    ) {
      const w = this.workspace(p.workspaceId);
      w.removedAt = now();
      w.state = "removed";
      this.store.put("workspaces", w);
    }
    p.usedAt = now();
    this.store.put("destroy_previews", p);
    return {
      partial: outcomes.some((o) => o.status === "failed"),
      outcomes,
      retainedBranches: p.retainedBranches,
    };
  }
  private async dispatch(name: string, i: any): Promise<any> {
    switch (name) {
      case "controller.status":
        return {
          protocolVersion: 1,
          pid: process.pid,
          startedAt: this.startedAt,
          stateRoot: this.stateRoot,
          version: "0.1.0",
        };
      case "projects.discover":
        return discoverProjectFolder(i.root, { depth: i.depth });
      case "projects.register":
        return this.createProject(i);
      case "projects.rebind": {
        const p = this.get<Project>("projects", i.projectId);
        if (
          this.store
            .all<Workspace>("workspaces")
            .some((w) => w.projectId === p.id && !w.removedAt)
        )
          throw new DomainError(
            "OPERATION_CONFLICT",
            "Project has active workspaces; remove or finish them before rebinding",
          );
        const root = await realpath(i.root);
        const revision = this.get<ConfigurationRevision>(
          "configuration_revisions",
          p.configurationRevisionId,
        );
        const repos: Repository[] = [];
        for (const entry of revision.manifest.repositories) {
          const old = this.store
            .all<Repository>("repositories")
            .find((r) => r.projectId === p.id && r.key === entry.key)!;
          repos.push({
            ...old,
            ...(await registerRepository(
              await containedRepository(root, entry.path),
            )),
          });
        }
        p.root = root;
        for (const r of repos) this.store.put("repositories", r);
        this.store.put("projects", p);
        return p;
      }
      case "projects.list":
        return this.store.all<Project>("projects");
      case "projects.get": {
        const project = this.get<Project>("projects", i.projectId);
        return {
          project,
          repositories: this.store
            .all<Repository>("repositories")
            .filter((r) => r.projectId === project.id),
          configuration: this.get(
            "configuration_revisions",
            project.configurationRevisionId,
          ),
        };
      }
      case "projects.unregister":
        if (
          this.store
            .all<Workspace>("workspaces")
            .some((w) => w.projectId === i.projectId && !w.removedAt)
        )
          throw new DomainError(
            "OPERATION_CONFLICT",
            "Project has active workspaces",
          );
        this.store.delete("projects", i.projectId);
        for (const r of this.store
          .all<Repository>("repositories")
          .filter((r) => r.projectId === i.projectId))
          this.store.delete("repositories", r.id);
        return { unregistered: true };
      case "configuration.validate":
        return {
          valid: true,
          manifest: validateConfiguration(i.manifest, i.root),
          warnings: [],
        };
      case "configuration.get":
        return this.get(
          "configuration_revisions",
          i.revisionId ??
            this.get<Project>("projects", i.projectId).configurationRevisionId,
        );
      case "configuration.export":
        return exportConfiguration(
          this.store,
          this.get<Project>("projects", i.projectId),
        );
      case "configuration.import":
        return importConfiguration(
          this.store,
          this.get<Project>("projects", i.projectId),
          i.manifest,
        );
      case "configuration.apply": {
        const w = this.workspace(i.workspaceId),
          r = this.get<ConfigurationRevision>(
            "configuration_revisions",
            i.revisionId,
          );
        if (r.projectId !== w.projectId)
          throw new DomainError(
            "INVALID_INPUT",
            "Revision belongs to another project",
          );
        if (
          [
            ...this.runtime.listServices(w.id),
            ...this.runtime.listResources(w.id),
          ].some(
            (s) =>
              !["stopped", "failed", "removed", "external"].includes(s.state),
          )
        )
          throw new DomainError(
            "OPERATION_CONFLICT",
            "Stop this workspace before applying a revision",
          );
        if (
          r.manifest.repositories.some(
            (repo) =>
              !this.checkouts(w.id).some((c) => c.repositoryKey === repo.key),
          )
        )
          throw new DomainError(
            "CONFIGURATION_CHANGED",
            "Create missing repository checkouts before applying this revision",
          );
        w.configurationRevisionId = r.id;
        this.store.put("workspaces", w);
        return w;
      }
      case "repositories.list":
        return this.store
          .all<Repository>("repositories")
          .filter((r) => !i.projectId || r.projectId === i.projectId);
      case "repositories.discover":
        return discoverWorktrees(
          this.get<Repository>("repositories", i.repositoryId).path,
        );
      case "repositories.register": {
        const p = this.get<Project>("projects", i.projectId);
        const info = await registerRepository(
          await containedRepository(p.root, i.path),
        );
        if (
          this.store
            .all<Repository>("repositories")
            .some((r) => r.projectId === p.id && r.key === i.key)
        )
          throw new DomainError("INVALID_INPUT", "Repository key exists");
        const r = { id: randomUUID(), projectId: p.id, key: i.key, ...info };
        this.store.put("repositories", r);
        return r;
      }
      case "repositories.update":
      case "repositories.unregister": {
        const r = this.get<Repository>("repositories", i.repositoryId);
        if (
          this.store
            .all<Checkout>("checkouts")
            .some((c) => c.repositoryId === r.id && !c.removedAt)
        )
          throw new DomainError(
            "OPERATION_CONFLICT",
            "Repository has active checkouts",
          );
        if (name === "repositories.unregister") {
          this.store.delete("repositories", r.id);
          return { unregistered: true };
        }
        Object.assign(
          r,
          await registerRepository(
            await containedRepository(
              this.get<Project>("projects", r.projectId).root,
              i.path,
            ),
          ),
        );
        this.store.put("repositories", r);
        return r;
      }
      case "workspaces.list":
        return this.store
          .all<Workspace>("workspaces")
          .filter(
            (w) =>
              !w.removedAt && (!i.projectId || w.projectId === i.projectId),
          )
          .map((w) => ({
            ...w,
            checkouts: this.checkouts(w.id),
            services: this.runtime.listServices(w.id),
            projectName: this.store.get<Project>("projects", w.projectId)?.name,
            configuration: this.revision(w),
            resources: this.runtime.listResources(w.id),
            hasRuntime: !!(
              this.revision(w).manifest.services.length +
              this.revision(w).manifest.resources.length
            ),
            entrypoints: this.revision(w).manifest.entrypoints.map((e) => ({
              ...e,
              url: this.runtime
                .listServices(w.id)
                .find((s) => s.repositoryKey + "/" + s.logicalId === e.service)
                ?.url,
            })),
          }));
      case "workspaces.create":
        return this.createWorkspace(i);
      case "workspaces.get":
        return this.snapshot(i.workspaceId);
      case "workspaces.rename": {
        const w = this.workspace(i.workspaceId);
        w.name = i.name;
        this.store.put("workspaces", w);
        return w;
      }
      case "checkouts.create":
        return this.newCheckout(i);
      case "checkouts.adopt": {
        const w = this.workspace(i.workspaceId),
          r = this.get<Repository>("repositories", i.repositoryId);
        if (r.projectId !== w.projectId)
          throw new DomainError(
            "INVALID_INPUT",
            "Repository belongs to another project",
          );
        const c = await adoptCheckout({
          repository: r,
          workspaceId: w.id,
          path: i.path,
        });
        if (
          this.store
            .all<Checkout>("checkouts")
            .some((x) => x.path === c.path && !x.removedAt)
        )
          throw new DomainError(
            "OPERATION_CONFLICT",
            "Checkout already managed",
          );
        this.store.put("checkouts", c);
        return c;
      }
      case "checkouts.get":
        return this.get<Checkout>("checkouts", i.checkoutId);
      case "changes.list":
        return readChanges(this.get<Checkout>("checkouts", i.checkoutId).path);
      case "changes.diff":
        return readDiff(
          this.get<Checkout>("checkouts", i.checkoutId).path,
          i.path,
          i.area,
        );
      case "history.list": {
        const c = this.get<Checkout>("checkouts", i.checkoutId);
        return readHistory(c.path, c.sourceCommit, i.limit, i.offset);
      }
      case "history.commit":
        return readCommit(
          this.get<Checkout>("checkouts", i.checkoutId).path,
          i.commit,
        );
      case "pullRequests.list": {
        const c = this.get<Checkout>("checkouts", i.checkoutId);
        return listPullRequests(c.path, await currentBranch(c.path));
      }
      case "pullRequests.get":
      case "pullRequests.diff": {
        const c = this.get<Checkout>("checkouts", i.checkoutId);
        const result = await readPullRequest(c.path, i.number, {
          repository: i.repository,
        });
        if (result.status === "unavailable") return result;
        return name.endsWith(".diff")
          ? {
              ...result.diff,
              headRefOid: result.headCommit,
              baseRefOid: result.baseCommit,
              refreshedAt: result.refreshedAt,
            }
          : { ...result.pullRequest, ...result, diff: result.diff };
      }
      case "profiles.list":
        return (
          exportConfiguration(
            this.store,
            this.get<Project>("projects", i.projectId),
          )?.services ?? []
        );
      case "profiles.save":
      case "profiles.remove": {
        const p = this.get<Project>("projects", i.projectId),
          m = exportConfiguration(this.store, p)!;
        const repository = i.repository ?? i.profile?.repository,
          id = i.profileId ?? i.profile?.id;
        if (
          name === "profiles.remove" &&
          this.store
            .all<Workspace>("workspaces")
            .some(
              (w) =>
                w.projectId === p.id &&
                !w.removedAt &&
                this.revision(w).manifest.services.some(
                  (s) => s.id === id && s.repository === repository,
                ),
            )
        )
          throw new DomainError("OPERATION_CONFLICT", "Profile is in use");
        m.services = m.services.filter(
          (s) => !(s.repository === repository && s.id === id),
        );
        if (name === "profiles.save") m.services.push(i.profile);
        return importConfiguration(this.store, p, m);
      }
      case "setup.run":
      case "lifecycle.start": {
        const w = this.workspace(i.workspaceId);
        try {
          const result =
            name === "setup.run"
              ? await this.runtime.prepare(
                  w,
                  this.revision(w),
                  this.checkouts(w.id),
                  i.checkoutId,
                )
              : await this.runtime.start(
                  w,
                  this.revision(w),
                  this.checkouts(w.id),
                  i.checkoutId,
                  i.serviceId,
                );
          w.state = name === "setup.run" ? w.state : "running";
          this.store.put("workspaces", w);
          return result;
        } catch (e) {
          w.state = "failed";
          this.store.put("workspaces", w);
          throw e;
        }
      }
      case "lifecycle.stop": {
        const result = await this.runtime.stop(
          i.workspaceId,
          i.checkoutId,
          i.serviceId,
        );
        await this.refresh(i);
        return result;
      }
      case "lifecycle.refresh":
        return this.refresh(i);
      case "setup.status":
        return this.runtime.listSetup(i.workspaceId);
      case "setup.logs":
        return this.runtime.logs(i.receiptId, i.offset, i.limit);
      case "services.list":
        return this.runtime.listServices(i.workspaceId);
      case "services.logs":
        return this.runtime.logs(i.serviceId, i.offset, i.limit);
      case "resources.list":
        return this.runtime.listResources(i.workspaceId);
      case "resources.status":
        return this.get("runtime_resources", i.resourceId);
      case "destroy.preview":
        return this.preview(i);
      case "destroy.execute":
        return this.destroy(i);
      case "operations.list":
        return this.store
          .all("operations")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 100);
      case "operations.get":
        return this.operations.get(i.operationId);
      case "operations.wait":
        return this.operations.wait(i.operationId, i.timeoutMs);
      case "integration.status":
        return this.integration.status();
      case "integration.preview":
        return this.integration.preview(i.action);
      case "integration.apply":
      case "integration.disconnect":
        return this.integration.apply(i.previewId);
      default:
        throw new DomainError("INVALID_INPUT", `Unsupported command ${name}`);
    }
  }
}
