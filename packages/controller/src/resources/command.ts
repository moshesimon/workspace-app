import { randomUUID } from "node:crypto";
import { DomainError } from "../../../contracts/src/errors.js";
import { runCommand, probeTcp } from "../services/processes.js";
import { resolveTemplate, containedPath } from "../services/profiles.js";
import type {
  ResourceContext,
  ResourceHandle,
  ResourceStatus,
  RuntimeAdapter,
} from "./adapter.js";
export class CommandAdapter implements RuntimeAdapter {
  constructor(
    private contextFor: (handle: ResourceHandle) => Promise<ResourceContext>,
  ) {}
  private async hook(
    context: ResourceContext,
    name: string,
    expectedIdentity?: string,
  ): Promise<ResourceStatus> {
    const hook = context.profile.hooks?.[name];
    if (!hook)
      throw new DomainError(
        "INVALID_INPUT",
        `Resource ${context.profile.id} lacks ${name} hook`,
      );
    const output = await runCommand(
      {
        executable: resolveTemplate(hook.executable, context.resolution),
        args: (hook.args ?? []).map((v: string) =>
          resolveTemplate(v, context.resolution),
        ),
      },
      context.resolved.cwd,
      {
        ...context.resolved.env,
        WORKTREE_RESOURCE_NAMESPACE: context.namespace,
        WORKTREE_RESOURCE_IDENTITY: expectedIdentity ?? "",
        WORKTREE_RESOURCE_PORT: String(context.assignedPort ?? ""),
      },
      context.logPath,
      context.resolution.secrets,
      15000,
    );
    let data: any;
    try {
      data = JSON.parse(output.trim());
    } catch {
      throw new DomainError(
        "OWNERSHIP_UNVERIFIED",
        `Resource ${name} hook must return one JSON object`,
      );
    }
    if (
      !data ||
      typeof data.identity !== "string" ||
      !data.identity ||
      data.namespace !== context.namespace ||
      (expectedIdentity && data.identity !== expectedIdentity) ||
      data.ownership !== "owned" ||
      !Array.isArray(data.observedPorts) ||
      data.observedPorts.some(
        (v: any) => !Number.isInteger(v) || v < 1 || v > 65535,
      ) ||
      !Array.isArray(data.dataPaths) ||
      data.dataPaths.some((v: any) => typeof v !== "string") ||
      !["ready", "running", "stopped", "failed"].includes(data.state)
    )
      throw new DomainError(
        "OWNERSHIP_UNVERIFIED",
        `Resource ${name} hook returned unverified identity or status`,
        { namespace: context.namespace },
      );
    for (const relative of data.dataPaths)
      await containedPath(context.resolution.checkoutPath, relative, false);
    if (
      (name === "start" || name === "status") &&
      data.state === "ready" &&
      context.assignedPort &&
      !data.observedPorts.includes(context.assignedPort)
    )
      throw new DomainError(
        "PORT_CONFLICT",
        "Resource published a different port",
      );
    return {
      namespace: data.namespace,
      identity: data.identity,
      state: data.state,
      observedPorts: data.observedPorts,
      dataPaths: data.dataPaths,
      ownership: data.ownership,
    };
  }
  async start(context: ResourceContext): Promise<ResourceHandle> {
    for (const relative of context.profile.disposablePaths ?? []) {
      if (!relative || relative === ".")
        throw new DomainError(
          "INVALID_INPUT",
          "Checkout root cannot be disposable",
        );
      await containedPath(context.resolution.checkoutPath, relative, true);
    }
    const started = await this.hook(context, "start");
    const handle: ResourceHandle = {
      id: randomUUID(),
      workspaceId: context.workspaceId,
      checkoutId: context.checkoutId,
      configurationRevisionId: context.configurationRevisionId,
      logicalId: context.profile.id,
      adapter: "command",
      namespace: context.namespace,
      identity: started.identity,
      ownership: "owned",
      state: started.state,
      assignedPort: context.assignedPort,
      url: context.url,
      observedPorts: started.observedPorts,
      dataPaths: started.dataPaths ?? [],
      disposablePaths: context.profile.disposablePaths ?? [],
      logPath: context.logPath,
      profile: context.profile,
    };
    context.persist?.(handle);
    const observed = await this.hook(context, "status", handle.identity);
    if (
      observed.state !== "ready" ||
      (context.assignedPort && !(await probeTcp(context.assignedPort)))
    )
      throw new DomainError(
        "DEPENDENCY_UNAVAILABLE",
        "Resource did not become healthy",
      );
    return { ...handle, ...observed, ownership: "owned" };
  }
  private verify(handle: ResourceHandle) {
    if (handle.ownership !== "owned" || !handle.identity || !handle.namespace)
      throw new DomainError(
        "OWNERSHIP_UNVERIFIED",
        "Resource has no verified start identity",
      );
  }
  async inspect(handle: ResourceHandle) {
    this.verify(handle);
    const status = await this.hook(
      await this.contextFor(handle),
      "status",
      handle.identity,
    );
    if (
      status.state === "ready" &&
      handle.assignedPort &&
      !(await probeTcp(handle.assignedPort))
    )
      status.state = "degraded";
    return status;
  }
  async stop(handle: ResourceHandle) {
    this.verify(handle);
    const ctx = await this.contextFor(handle);
    await this.hook(ctx, "status", handle.identity);
    await this.hook(ctx, "stop", handle.identity);
  }
  async destroy(handle: ResourceHandle, preview: any) {
    this.verify(handle);
    if (
      !preview?.resources?.some(
        (r: any) =>
          r.id === handle.id &&
          r.identity === handle.identity &&
          r.namespace === handle.namespace,
      )
    )
      throw new DomainError(
        "STALE_PREVIEW",
        "Resource cleanup was not previewed",
      );
    const ctx = await this.contextFor(handle);
    await this.hook(ctx, "status", handle.identity);
    await this.hook(ctx, "destroy", handle.identity);
  }
}
