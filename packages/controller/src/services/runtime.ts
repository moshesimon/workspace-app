import path from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import type { Store } from "../store.js";
import type {
  Workspace,
  Checkout,
  ConfigurationRevision,
  ServiceInstance,
  RuntimeResource,
  SetupReceipt,
} from "../../../contracts/src/models.js";
import { DomainError } from "../../../contracts/src/errors.js";
import { allocatePorts, type PortLease } from "./ports.js";
import {
  resolveProfile,
  resolveTemplate,
  containedPath,
  type ResolutionContext,
} from "./profiles.js";
import {
  launch,
  waitReady,
  inspectProcess,
  stopProcess,
  readLogs,
  probeTcp,
} from "./processes.js";
import { checkPrerequisites, runSetup, successProbe } from "../setup/runner.js";
import { inputFingerprint, repositoryInputs } from "../setup/receipts.js";
import { ProcessAdapter } from "../resources/process.js";
import { CommandAdapter } from "../resources/command.js";
import type {
  ResourceContext,
  ResourceHandle,
  RuntimeAdapter,
} from "../resources/adapter.js";
type Node = {
  key: string;
  kind: "service" | "resource" | "setup";
  profile: any;
  checkout: Checkout;
  row?: any;
  port?: number;
  url?: string;
  context?: ResolutionContext;
  resolved?: any;
};
const now = () => new Date().toISOString();
export class RuntimeManager {
  private salt: Buffer;
  private cached = new Map<
    string,
    {
      workspace: Workspace;
      revision: ConfigurationRevision;
      checkouts: Checkout[];
    }
  >();
  private processAdapter: ProcessAdapter;
  private commandAdapter: CommandAdapter;
  constructor(
    private store: Store,
    private dataRoot: string,
  ) {
    mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
    const saltPath = path.join(dataRoot, "receipt-key");
    try {
      this.salt = readFileSync(saltPath);
    } catch {
      this.salt = randomBytes(32);
      writeFileSync(saltPath, this.salt, { mode: 0o600 });
    }
    this.processAdapter = new ProcessAdapter((h) => this.resourceContext(h));
    this.commandAdapter = new CommandAdapter((h) => this.resourceContext(h));
    for (const receipt of this.store.all<any>("setup_receipts"))
      if (receipt.state === "running") {
        receipt.state = "failed";
        receipt.error = {
          code: "INTERRUPTED",
          message: "Preparation interrupted before recording completion",
        };
        this.store.put("setup_receipts", receipt);
      }
  }
  listServices(workspaceId: string): ServiceInstance[] {
    return this.store
      .all<ServiceInstance>("service_instances")
      .filter((r) => r.workspaceId === workspaceId);
  }
  listResources(workspaceId: string): RuntimeResource[] {
    return this.store
      .all<RuntimeResource>("runtime_resources")
      .filter((r) => r.workspaceId === workspaceId);
  }
  listSetup(workspaceId: string): SetupReceipt[] {
    return this.store
      .all<SetupReceipt>("setup_receipts")
      .filter((r) => r.workspaceId === workspaceId);
  }
  logs(id: string, offset = 0, limit = 65536) {
    const row =
      this.store.get<any>("service_instances", id) ??
      this.store.get<any>("setup_receipts", id) ??
      this.store.get<any>("runtime_resources", id);
    if (!row) throw new DomainError("INVALID_INPUT", "Unknown log record");
    return readLogs(row.logPath ?? "", offset, limit);
  }
  async start(
    workspace: Workspace,
    revision: ConfigurationRevision,
    checkouts: Checkout[],
    selectedCheckoutId?: string,
    selectedServiceId?: string,
  ) {
    return this.execute(
      workspace,
      revision,
      checkouts,
      selectedCheckoutId,
      false,
      selectedServiceId,
    );
  }
  async prepare(
    workspace: Workspace,
    revision: ConfigurationRevision,
    checkouts: Checkout[],
    selectedCheckoutId?: string,
  ) {
    return this.execute(
      workspace,
      revision,
      checkouts,
      selectedCheckoutId,
      true,
    );
  }
  private scope(workspaceId: string) {
    const cached = this.cached.get(workspaceId);
    if (cached) return cached;
    const workspace = this.store.get<Workspace>("workspaces", workspaceId);
    if (!workspace) throw new DomainError("INVALID_INPUT", "Unknown workspace");
    const revision = this.store.get<ConfigurationRevision>(
      "configuration_revisions",
      workspace.configurationRevisionId,
    );
    if (!revision)
      throw new DomainError("INVALID_INPUT", "Unknown pinned configuration");
    return {
      workspace,
      revision,
      checkouts: this.store
        .all<Checkout>("checkouts")
        .filter((c) => c.workspaceId === workspaceId),
    };
  }
  private nodes(
    revision: ConfigurationRevision,
    checkouts: Checkout[],
  ): Node[] {
    const result: Node[] = [];
    for (const [kind, profiles] of [
      ["resource", revision.manifest.resources],
      ["setup", revision.manifest.setup],
      ["service", revision.manifest.services],
    ] as const)
      for (const profile of profiles) {
        const checkout = checkouts.find(
          (c) => c.repositoryKey === profile.repository,
        );
        if (!checkout) continue;
        result.push({
          key: `${kind}:${kind === "service" ? profile.repository + "/" : ""}${profile.id}`,
          kind,
          profile,
          checkout,
        });
      }
    return result;
  }
  private existing(workspaceId: string, node: Node) {
    const table =
      node.kind === "service"
        ? "service_instances"
        : node.kind === "resource"
          ? "runtime_resources"
          : "setup_receipts";
    return this.store
      .all<any>(table)
      .filter(
        (r) =>
          r.workspaceId === workspaceId &&
          r.checkoutId === node.checkout.id &&
          r.logicalId === node.profile.id,
      )
      .at(-1);
  }
  private urls(nodes: Node[], revision: ConfigurationRevision) {
    const urls: Record<string, string> = {};
    for (const n of nodes)
      if (n.url) {
        if (n.kind === "service") {
          urls[`service.${n.profile.repository}/${n.profile.id}.url`] = n.url;
          const same = nodes.filter(
            (v) => v.kind === "service" && v.profile.id === n.profile.id,
          );
          if (same.length === 1) urls[`service.${n.profile.id}.url`] = n.url;
        }
        if (n.kind === "resource") urls[`resource.${n.profile.id}.url`] = n.url;
      }
    for (const [binding, target] of Object.entries(
      revision.manifest.bindings ?? {},
    ))
      if (urls[`service.${target}.url`])
        urls[`service.${binding}.url`] = urls[`service.${target}.url`];
    return urls;
  }
  private resolution(
    node: Node,
    workspaceId: string,
    urls: Record<string, string>,
    revision: ConfigurationRevision,
  ): ResolutionContext {
    const scoped = { ...urls };
    for (const n of revision.manifest.services) {
      const target =
        revision.manifest.bindings?.[`${node.profile.repository}/${n.id}`] ??
        revision.manifest.bindings?.[n.id] ??
        `${node.profile.repository}/${n.id}`;
      if (urls[`service.${target}.url`])
        scoped[`service.${n.id}.url`] = urls[`service.${target}.url`];
    }
    return {
      workspaceId,
      checkoutPath: node.checkout.path,
      port: node.port,
      url: node.url,
      urls: scoped,
      secrets: new Set(),
    };
  }
  private async execute(
    workspace: Workspace,
    revision: ConfigurationRevision,
    checkouts: Checkout[],
    selectedCheckoutId: string | undefined,
    preparationOnly: boolean,
    selectedServiceId?: string,
  ) {
    if (workspace.configurationRevisionId !== revision.id)
      throw new DomainError(
        "CONFIGURATION_CHANGED",
        "Workspace must use its pinned revision",
      );
    if (
      selectedCheckoutId &&
      !checkouts.some((c) => c.id === selectedCheckoutId)
    )
      throw new DomainError("INVALID_INPUT", "Unknown checkout in workspace");
    this.cached.set(workspace.id, { workspace, revision, checkouts });
    const all = this.nodes(revision, checkouts);
    const selected = all.filter(
      (n) =>
        (!selectedCheckoutId || n.checkout.id === selectedCheckoutId) &&
        (!selectedServiceId ||
          (n.kind === "service" &&
            (n.profile.id === selectedServiceId ||
              `${n.profile.repository}/${n.profile.id}` === selectedServiceId ||
              this.existing(workspace.id, n)?.id === selectedServiceId))),
    );
    if (selectedServiceId && selected.length !== 1)
      throw new DomainError("INVALID_INPUT", "Unknown or ambiguous service");
    const needed = new Set(
      selected
        .filter((n) => !preparationOnly || n.kind !== "service")
        .map((n) => n.key),
    );
    const addAncestors = (key: string) => {
      const node = all.find((n) => n.key === key);
      if (!node) return;
      for (const dep of node.profile.dependsOn ?? []) {
        const found = selected.find((n) => n.key === dep);
        if (found && !needed.has(dep)) {
          needed.add(dep);
          addAncestors(dep);
        }
      }
    };
    if (!selectedServiceId) for (const key of [...needed]) addAncestors(key);
    const graph = selected.filter((n) => needed.has(n.key));
    const order: Node[] = [];
    const visiting = new Set<string>(),
      done = new Set<string>();
    const visit = (n: Node) => {
      if (visiting.has(n.key))
        throw new DomainError("INVALID_INPUT", "Execution dependency cycle");
      if (done.has(n.key)) return;
      visiting.add(n.key);
      for (const dep of n.profile.dependsOn ?? []) {
        const next = graph.find((v) => v.key === dep);
        if (next) visit(next);
        else if (!all.some((v) => v.key === dep))
          throw new DomainError("INVALID_INPUT", `Unknown dependency ${dep}`);
      }
      visiting.delete(n.key);
      done.add(n.key);
      order.push(n);
    };
    for (const n of graph) visit(n);
    const leases = new Map<string, PortLease>();
    const launched: Array<{ kind: string; row: any }> = [];
    try {
      await checkPrerequisites(
        revision.manifest.prerequisites,
        checkouts[0]?.path ?? this.dataRoot,
        path.join(this.dataRoot, "logs", `${workspace.id}-prerequisites.log`),
      );
      const excluded = new Set(
        this.store
          .all<any>("port_reservations")
          .filter(
            (r) =>
              r.workspaceId !== workspace.id &&
              ["reserved", "active"].includes(r.state),
          )
          .map((r) => r.port),
      );
      const specs: Array<{ id: string; port: any }> = [];
      for (const n of all) {
        n.row = this.existing(workspace.id, n);
        if (
          n.kind !== "setup" &&
          n.row &&
          ["ready", "running", "starting", "degraded", "unknown"].includes(
            n.row.state,
          )
        ) {
          if (
            n.row.configurationRevisionId &&
            n.row.configurationRevisionId !== revision.id
          )
            throw new DomainError(
              "CONFIGURATION_CHANGED",
              "Existing runtime uses a different configuration",
            );
          const state =
            n.kind === "service"
              ? await inspectProcess(n.row)
              : await this.inspectResource(n.row);
          if (!["ready", "running"].includes(state.state))
            throw new DomainError(
              "OWNERSHIP_UNVERIFIED",
              `Existing runtime ${n.key} needs Refresh before Start`,
            );
          if (
            n.row.assignedPort &&
            !state.observedPorts.includes(n.row.assignedPort)
          )
            throw new DomainError(
              "PORT_CONFLICT",
              `Existing runtime ${n.key} is not listening on its assigned port`,
            );
          n.row.state = "ready";
          this.store.put(
            n.kind === "service" ? "service_instances" : "runtime_resources",
            n.row,
          );
          n.port = n.row.assignedPort;
          n.url = n.row.url;
          continue;
        }
        if (n.kind !== "setup" && n.profile.port && selected.includes(n))
          specs.push({
            id: n.key,
            port: {
              ...n.profile.port,
              preferred: n.row?.assignedPort ?? n.profile.port.preferred,
            },
          });
        else {
          n.port = n.row?.assignedPort;
          n.url = n.row?.url;
        }
      }
      const allocated = await allocatePorts(specs, excluded);
      for (const [key, lease] of allocated) leases.set(key, lease);
      for (const n of all) {
        const lease = leases.get(n.key);
        if (lease) n.port = lease.port;
        if (!n.url)
          n.url = n.port ? `http://127.0.0.1:${n.port}` : n.profile.url;
      }
      let urls = this.urls(all, revision);
      for (const n of all) {
        const ctx = this.resolution(n, workspace.id, urls, revision);
        if (n.profile.url) {
          if (/\{\{\s*secret\./.test(n.profile.url))
            throw new DomainError(
              "INVALID_INPUT",
              "Resource and service URLs cannot persist secrets",
            );
          n.url = resolveTemplate(n.profile.url, ctx);
        }
      }
      urls = this.urls(all, revision);
      for (const n of selected) {
        n.context = this.resolution(n, workspace.id, urls, revision);
        if (n.kind === "resource" && !n.profile.executable) {
          n.resolved = {
            args: [],
            cwd: await containedPath(n.checkout.path, n.profile.cwd ?? "."),
            env: Object.fromEntries(
              Object.entries(n.profile.env ?? {}).map(([key, value]) => [
                key,
                resolveTemplate(String(value), n.context!),
              ]),
            ),
          };
        } else n.resolved = await resolveProfile(n.profile, n.context);
        if (n.kind !== "setup" && n.row?.state !== "ready") {
          const id = n.row?.id ?? randomUUID();
          n.row = {
            id,
            workspaceId: workspace.id,
            checkoutId: n.checkout.id,
            configurationRevisionId: revision.id,
            logicalId: n.profile.id,
            repositoryKey: n.profile.repository,
            state: "planned",
            dependencies: n.profile.dependsOn ?? [],
            assignedPort: n.port,
            preferredPort: n.profile.port?.preferred,
            url: n.url,
            profile: n.profile,
            logPath: path.join(this.dataRoot, "logs", `${id}.log`),
            createdAt: n.row?.createdAt ?? now(),
          };
          if (n.kind === "resource")
            Object.assign(n.row, {
              adapter: n.profile.adapter,
              namespace: `wm-${workspace.id}-${n.checkout.id}-${n.profile.id}`,
              ownership:
                n.profile.adapter === "external" ? "external" : "unknown",
              observedPorts: [],
              dataPaths: [],
              disposablePaths: n.profile.disposablePaths ?? [],
            });
          this.store.put(
            n.kind === "service" ? "service_instances" : "runtime_resources",
            n.row,
          );
          if (n.port)
            this.store.put("port_reservations", {
              id: `${workspace.id}:${n.key}`,
              workspaceId: workspace.id,
              checkoutId: n.checkout.id,
              port: n.port,
              state: "reserved",
              ownerId: id,
            });
        }
      }
      for (const n of order) {
        for (const dep of n.profile.dependsOn ?? []) {
          const dependency = all.find((v) => v.key === dep)!;
          const row =
            dependency.kind === "setup"
              ? this.existing(workspace.id, dependency)
              : dependency.row;
          if (
            !row ||
            !(dependency.kind === "setup"
              ? row.state === "succeeded"
              : row.state === "ready")
          )
            throw new DomainError(
              "DEPENDENCY_UNAVAILABLE",
              `Dependency ${dep} is unavailable for ${n.key}`,
            );
        }
        if (n.kind === "setup") {
          const id = randomUUID();
          n.row = await runSetup(
            this.store,
            this.salt,
            {
              workspaceId: workspace.id,
              checkoutId: n.checkout.id,
              configurationRevisionId: revision.id,
              configurationHash: revision.hash,
            },
            n.profile,
            n.resolved,
            n.context!,
            path.join(this.dataRoot, "logs", `${id}.log`),
          );
          continue;
        }
        if (n.row.state === "ready") continue;
        const lease = leases.get(n.key);
        if (lease) {
          await lease.release();
          leases.delete(n.key);
        }
        if (n.kind === "service") {
          for (const directory of n.profile.runtimePaths ?? [])
            await containedPath(n.checkout.path, directory, true);
          const identity = await launch(
            n.resolved,
            n.row.logPath,
            n.context!.secrets,
          );
          Object.assign(n.row, identity, {
            state: "starting",
            ownership: "owned",
            startedAt: now(),
          });
          this.store.put("service_instances", n.row);
          launched.push({ kind: "service", row: n.row });
          Object.assign(
            n.row,
            await waitReady(
              n.row,
              n.profile.readiness ?? { type: n.port ? "tcp" : "process" },
            ),
          );
          this.store.put("service_instances", n.row);
        } else if (n.profile.adapter === "external") {
          Object.assign(n.row, await this.inspectResource(n.row));
          if (n.row.state !== "ready")
            throw new DomainError(
              "DEPENDENCY_UNAVAILABLE",
              `External resource ${n.profile.id} is unavailable`,
            );
          this.store.put("runtime_resources", n.row);
        } else {
          const context = await this.resourceContext(n.row);
          context.persist = (handle) => {
            Object.assign(n.row, handle, {
              id: n.row.id,
              dependencies: n.profile.dependsOn ?? [],
              startedAt: now(),
            });
            this.store.put("runtime_resources", n.row);
            if (!launched.some((item) => item.row.id === n.row.id))
              launched.push({ kind: "resource", row: n.row });
          };
          let handle: ResourceHandle;
          try {
            handle = await this.adapter(n.row).start(context);
          } catch (startError: any) {
            if (n.profile.adapter === "command" && !n.row.identity) {
              n.row.state = "unknown";
              n.row.error = {
                code: startError.code ?? "OWNERSHIP_UNVERIFIED",
                message: startError.message,
              };
              this.store.put("runtime_resources", n.row);
            }
            throw startError;
          }
          Object.assign(n.row, handle, {
            id: n.row.id,
            dependencies: n.profile.dependsOn ?? [],
            startedAt: now(),
          });
          this.store.put("runtime_resources", n.row);
          if (!launched.some((item) => item.row.id === n.row.id))
            launched.push({ kind: "resource", row: n.row });
        }
        if (n.port)
          this.store.put("port_reservations", {
            id: `${workspace.id}:${n.key}`,
            workspaceId: workspace.id,
            checkoutId: n.checkout.id,
            port: n.port,
            state: "active",
            ownerId: n.row.id,
          });
      }
      return {
        services: this.listServices(workspace.id),
        resources: this.listResources(workspace.id),
        setup: this.listSetup(workspace.id),
      };
    } catch (error: any) {
      for (const item of launched.reverse()) {
        try {
          if (item.kind === "service") await stopProcess(item.row);
          else await this.adapter(item.row).stop(item.row);
          item.row.state = "failed";
          item.row.error = {
            code: error.code ?? "DEPENDENCY_UNAVAILABLE",
            message: error.message,
          };
          this.store.put(
            item.kind === "service" ? "service_instances" : "runtime_resources",
            item.row,
          );
          this.releaseReservations(item.row.id);
        } catch (cleanup: any) {
          item.row.state = "unknown";
          item.row.error = {
            code: cleanup.code ?? "OWNERSHIP_UNVERIFIED",
            message: cleanup.message,
          };
          this.store.put(
            item.kind === "service" ? "service_instances" : "runtime_resources",
            item.row,
          );
        }
      }
      for (const n of graph)
        if (n.kind === "setup" && !n.row) {
          this.store.put("setup_receipts", {
            id: randomUUID(),
            workspaceId: workspace.id,
            checkoutId: n.checkout.id,
            configurationRevisionId: revision.id,
            logicalId: n.profile.id,
            state: "blocked",
            error: {
              code: error.code ?? "DEPENDENCY_UNAVAILABLE",
              message: error.message,
            },
            createdAt: now(),
          });
        }
      throw error instanceof DomainError
        ? error
        : new DomainError(
            "DEPENDENCY_UNAVAILABLE",
            error.message ?? String(error),
          );
    } finally {
      await Promise.all([...leases.values()].map((l) => l.release()));
    }
  }
  private releaseReservations(ownerId: string) {
    for (const row of this.store.all<any>("port_reservations"))
      if (row.ownerId === ownerId)
        this.store.delete("port_reservations", row.id);
  }
  private adapter(handle: any): RuntimeAdapter {
    return handle.adapter === "command"
      ? this.commandAdapter
      : this.processAdapter;
  }
  private async resourceContext(
    handle: ResourceHandle,
  ): Promise<ResourceContext> {
    const scope = this.scope(handle.workspaceId);
    const nodes = this.nodes(scope.revision, scope.checkouts);
    for (const n of nodes) {
      const row = this.existing(handle.workspaceId, n);
      n.port = row?.assignedPort;
      n.url = row?.url;
    }
    const node = nodes.find(
      (n) =>
        n.kind === "resource" &&
        n.profile.id === handle.logicalId &&
        n.checkout.id === handle.checkoutId,
    );
    if (!node)
      throw new DomainError(
        "CONFIGURATION_CHANGED",
        "Resource configuration is unavailable",
      );
    const resolution = this.resolution(
      node,
      handle.workspaceId,
      this.urls(nodes, scope.revision),
      scope.revision,
    );
    const profile = handle.profile ?? node.profile;
    let resolved: any;
    if (profile.executable)
      resolved = await resolveProfile(profile, resolution);
    else
      resolved = {
        args: [],
        cwd: await containedPath(node.checkout.path, profile.cwd ?? "."),
        env: Object.fromEntries(
          Object.entries(profile.env ?? {}).map(([key, value]) => [
            key,
            resolveTemplate(String(value), resolution),
          ]),
        ),
      };
    return {
      workspaceId: handle.workspaceId,
      checkoutId: handle.checkoutId,
      configurationRevisionId: handle.configurationRevisionId,
      namespace: handle.namespace,
      profile,
      resolved,
      resolution,
      assignedPort: handle.assignedPort,
      url: handle.url,
      logPath: handle.logPath,
    };
  }
  private async inspectResource(row: any) {
    if (row.adapter === "external") {
      try {
        const url = new URL(row.url);
        const healthy = ["http:", "https:"].includes(url.protocol)
          ? (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok
          : !!url.port && (await probeTcp(Number(url.port), url.hostname));
        return {
          state: healthy ? "ready" : "degraded",
          ownership: "external",
          observedPorts: url.port && healthy ? [Number(url.port)] : [],
        };
      } catch {
        return {
          state: "unavailable",
          ownership: "external",
          observedPorts: [],
        };
      }
    }
    return this.adapter(row).inspect(row);
  }
  private reverseOrder(rows: any[]) {
    const result: any[] = [];
    const visiting = new Set<string>(),
      done = new Set<string>();
    const key = (row: any) =>
      `${row.adapter ? "resource" : "service"}:${row.adapter ? "" : row.repositoryKey + "/"}${row.logicalId}`;
    const visit = (row: any) => {
      if (done.has(row.id) || visiting.has(row.id)) return;
      visiting.add(row.id);
      for (const dep of row.dependencies ?? []) {
        const dependency = rows.find((r) => key(r) === dep);
        if (dependency) visit(dependency);
      }
      done.add(row.id);
      result.push(row);
    };
    for (const row of rows) visit(row);
    return result.reverse();
  }
  async stop(workspaceId: string, checkoutId?: string, serviceId?: string) {
    if (
      checkoutId &&
      !this.cached
        .get(workspaceId)
        ?.checkouts.some((c) => c.id === checkoutId) &&
      !this.store
        .all<any>("checkouts")
        .some((c) => c.id === checkoutId && c.workspaceId === workspaceId)
    )
      throw new DomainError("INVALID_INPUT", "Unknown checkout scope");
    const inScope = (r: any) =>
      (!checkoutId || r.checkoutId === checkoutId) &&
      (!serviceId ||
        (!r.adapter &&
          (r.id === serviceId ||
            r.logicalId === serviceId ||
            `${r.repositoryKey}/${r.logicalId}` === serviceId)));
    if (
      serviceId &&
      this.listServices(workspaceId).filter(inScope).length !== 1
    )
      throw new DomainError("INVALID_INPUT", "Unknown or ambiguous service");
    const rows = this.reverseOrder(
      [
        ...this.listServices(workspaceId),
        ...this.listResources(workspaceId),
      ].filter(
        (r) =>
          inScope(r) &&
          r.ownership !== "external" &&
          !["planned", "stopped", "failed"].includes(r.state),
      ),
    );
    const outcomes: any[] = [];
    let failure: DomainError | undefined;
    for (const row of rows) {
      try {
        if (row.adapter) await this.adapter(row).stop(row as ResourceHandle);
        else await stopProcess(row);
        row.state = "stopped";
        row.stoppedAt = now();
        this.releaseReservations(row.id);
        outcomes.push({ id: row.id, status: "stopped" });
      } catch (e: any) {
        row.state = "unknown";
        row.error = {
          code: e.code ?? "OWNERSHIP_UNVERIFIED",
          message: e.message,
        };
        failure ??= e;
        outcomes.push({ id: row.id, status: "failed", error: row.error });
      }
      this.store.put(
        row.adapter ? "runtime_resources" : "service_instances",
        row,
      );
    }
    for (const row of [
      ...this.listServices(workspaceId),
      ...this.listResources(workspaceId),
    ])
      if (row.state === "planned" && inScope(row)) {
        row.state = "stopped";
        this.store.put(
          row.adapter ? "runtime_resources" : "service_instances",
          row,
        );
        this.releaseReservations(row.id);
      }
    if (failure)
      throw new DomainError(
        failure.code ?? "OWNERSHIP_UNVERIFIED",
        failure.message,
        { outcomes },
      );
    return { outcomes };
  }
  async refresh(workspaceId: string) {
    for (const row of this.listServices(workspaceId)) {
      if (!row.pid) continue;
      try {
        Object.assign(row, await inspectProcess(row));
        if (row.state === "running") {
          if (row.assignedPort && !row.observedPorts.includes(row.assignedPort))
            row.state = "degraded";
          else {
            const observed = await waitReady(
              row,
              {
                ...(row.profile?.readiness ?? {
                  type: row.assignedPort ? "tcp" : "process",
                }),
                timeoutMs: 500,
              },
              500,
            );
            Object.assign(row, observed);
          }
        }
      } catch (e: any) {
        row.state = e.code === "OWNERSHIP_UNVERIFIED" ? "unknown" : "degraded";
        row.error = {
          code: e.code ?? "DEPENDENCY_UNAVAILABLE",
          message: e.message,
        };
      }
      row.refreshedAt = now();
      this.store.put("service_instances", row);
    }
    for (const row of this.listResources(workspaceId)) {
      if (row.state === "planned") continue;
      try {
        Object.assign(row, await this.inspectResource(row));
      } catch (e: any) {
        row.state = ["DEPENDENCY_UNAVAILABLE", "PORT_CONFLICT"].includes(e.code)
          ? "degraded"
          : "unknown";
        row.error = {
          code: e.code ?? "OWNERSHIP_UNVERIFIED",
          message: e.message,
        };
      }
      row.refreshedAt = now();
      this.store.put("runtime_resources", row);
    }
    const scope = this.scope(workspaceId);
    const nodes = this.nodes(scope.revision, scope.checkouts);
    for (const n of nodes) {
      n.row = this.existing(workspaceId, n);
      n.port = n.row?.assignedPort;
      n.url = n.row?.url;
    }
    for (const receipt of this.listSetup(workspaceId)) {
      if (receipt.state !== "succeeded") continue;
      const n = nodes.find(
        (n) =>
          n.kind === "setup" &&
          n.profile.id === receipt.logicalId &&
          n.checkout.id === receipt.checkoutId,
      );
      if (!n) {
        receipt.state = "stale";
      } else {
        const ctx = this.resolution(
          n,
          workspaceId,
          this.urls(nodes, scope.revision),
          scope.revision,
        );
        try {
          const resolved = await resolveProfile(n.profile, ctx);
          const hash = inputFingerprint(this.salt, {
            profile: n.profile,
            configuration: scope.revision.hash,
            repository: await repositoryInputs(ctx.checkoutPath),
            resolved,
          });
          if (
            hash !== receipt.inputHash ||
            !(await successProbe(n.profile, resolved, ctx, receipt.logPath))
          )
            receipt.state = "stale";
        } catch {
          receipt.state = "blocked";
        }
      }
      this.store.put("setup_receipts", receipt);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of nodes) {
        const row = this.existing(workspaceId, n);
        if (!row || row.state !== "ready") continue;
        if (
          (n.profile.dependsOn ?? []).some((dep: string) => {
            const dependency = nodes.find((v) => v.key === dep);
            const target = dependency && this.existing(workspaceId, dependency);
            return (
              !target ||
              !(dependency?.kind === "setup"
                ? target.state === "succeeded"
                : target.state === "ready")
            );
          })
        ) {
          row.state = "degraded";
          row.error = {
            code: "DEPENDENCY_UNAVAILABLE",
            message: "A required dependency is unavailable",
          };
          this.store.put(
            n.kind === "service" ? "service_instances" : "runtime_resources",
            row,
          );
          changed = true;
        }
      }
    }
    return {
      services: this.listServices(workspaceId),
      resources: this.listResources(workspaceId),
      setup: this.listSetup(workspaceId),
    };
  }
  async destroy(workspaceId: string, checkoutId?: string, preview?: any) {
    await this.stop(workspaceId, checkoutId);
    const outcomes: any[] = [];
    for (const row of this.listResources(workspaceId).filter(
      (r) => !checkoutId || r.checkoutId === checkoutId,
    )) {
      if (row.ownership === "external") {
        outcomes.push({ id: row.id, status: "retained" });
        continue;
      }
      try {
        if (row.ownership !== "owned")
          throw new DomainError(
            "OWNERSHIP_UNVERIFIED",
            "Resource ownership is unverified",
          );
        await this.adapter(row).destroy(row as ResourceHandle, preview);
        row.state = "destroyed";
        this.store.put("runtime_resources", row);
        outcomes.push({ id: row.id, status: "destroyed" });
      } catch (e: any) {
        outcomes.push({
          id: row.id,
          status: "failed",
          error: { code: e.code ?? "OWNERSHIP_UNVERIFIED", message: e.message },
        });
      }
    }
    if (outcomes.some((o) => o.status === "failed"))
      throw new DomainError(
        "OWNERSHIP_UNVERIFIED",
        "Some resources could not be destroyed",
        { outcomes },
      );
    return { outcomes };
  }
}
