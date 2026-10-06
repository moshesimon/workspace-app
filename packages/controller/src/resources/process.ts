import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { DomainError } from "../../../contracts/src/errors.js";
import {
  launch,
  inspectProcess,
  waitReady,
  stopProcess,
} from "../services/processes.js";
import { containedPath } from "../services/profiles.js";
import type {
  ResourceContext,
  ResourceHandle,
  RuntimeAdapter,
} from "./adapter.js";
export class ProcessAdapter implements RuntimeAdapter {
  constructor(
    private contextFor: (handle: ResourceHandle) => Promise<ResourceContext>,
  ) {}
  async start(context: ResourceContext): Promise<ResourceHandle> {
    for (const relative of context.profile.disposablePaths ?? []) {
      if (!relative || relative === ".")
        throw new DomainError(
          "INVALID_INPUT",
          "Checkout root cannot be disposable",
        );
      await containedPath(context.resolution.checkoutPath, relative, true);
    }
    if (!context.resolved.executable)
      throw new DomainError(
        "INVALID_INPUT",
        "Process resource requires executable",
      );
    const process = await launch(
      {
        ...context.resolved,
        executable: context.resolved.executable,
        env: {
          ...context.resolved.env,
          WORKTREE_RESOURCE_NAMESPACE: context.namespace,
        },
      },
      context.logPath,
      context.resolution.secrets,
    );
    const handle: ResourceHandle = {
      id: randomUUID(),
      workspaceId: context.workspaceId,
      checkoutId: context.checkoutId,
      configurationRevisionId: context.configurationRevisionId,
      logicalId: context.profile.id,
      adapter: "process",
      namespace: context.namespace,
      identity: `${process.pid}:${process.startIdentity}`,
      ownership: "owned",
      state: "starting",
      assignedPort: context.assignedPort,
      url: context.url,
      observedPorts: [],
      dataPaths: context.profile.disposablePaths ?? [],
      disposablePaths: context.profile.disposablePaths ?? [],
      logPath: context.logPath,
      profile: context.profile,
      ...process,
    };
    context.persist?.(handle);
    try {
      return {
        ...handle,
        ...(await waitReady(handle, {
          type: context.assignedPort ? "tcp" : "process",
        })),
      };
    } catch (e) {
      await stopProcess(handle);
      throw e;
    }
  }
  async inspect(handle: ResourceHandle) {
    const state = await inspectProcess(handle);
    return {
      ...state,
      state:
        state.state === "running" &&
        (!handle.assignedPort ||
          state.observedPorts.includes(handle.assignedPort))
          ? "ready"
          : state.state === "running"
            ? "degraded"
            : state.state,
    };
  }
  async stop(handle: ResourceHandle) {
    await stopProcess(handle);
  }
  async destroy(handle: ResourceHandle, preview: any) {
    const allowed = preview?.resources?.find(
      (r: any) =>
        r.id === handle.id &&
        r.identity === handle.identity &&
        r.namespace === handle.namespace,
    );
    if (!allowed)
      throw new DomainError(
        "STALE_PREVIEW",
        "Resource cleanup was not previewed",
      );
    await this.stop(handle);
    const context = await this.contextFor(handle);
    for (const relative of handle.disposablePaths) {
      if (!allowed.disposablePaths?.includes(relative))
        throw new DomainError(
          "STALE_PREVIEW",
          "Disposable data was not previewed",
        );
      const target = await containedPath(
        context.resolution.checkoutPath,
        relative,
        false,
      );
      if (target === context.resolution.checkoutPath)
        throw new DomainError(
          "NOT_MANAGED",
          "Checkout root cannot be disposable",
        );
      await rm(target, { recursive: true, force: true });
    }
  }
}
