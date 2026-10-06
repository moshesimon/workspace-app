import { randomUUID } from "node:crypto";
import { DomainError } from "../../../contracts/src/errors.js";
import { resolveTemplate } from "../services/profiles.js";
import { runCommand } from "../services/processes.js";
import { inputFingerprint, repositoryInputs } from "./receipts.js";
import type { ResolutionContext } from "../services/profiles.js";
export async function checkPrerequisites(
  prerequisites: any[],
  cwd: string,
  logPath: string,
) {
  for (const check of prerequisites)
    await runCommand(
      { executable: check.executable, args: check.args ?? ["--version"] },
      cwd,
      {},
      logPath,
      new Set(),
      5000,
    );
}
export async function successProbe(
  profile: any,
  resolved: any,
  context: ResolutionContext,
  logPath: string,
) {
  if (!profile.probe) return true;
  try {
    await runCommand(
      {
        executable: resolveTemplate(profile.probe.executable, context),
        args: (profile.probe.args ?? []).map((v: string) =>
          resolveTemplate(v, context),
        ),
      },
      resolved.cwd,
      resolved.env,
      logPath,
      context.secrets,
      5000,
    );
    return true;
  } catch {
    return false;
  }
}
export async function runSetup(
  store: any,
  salt: Buffer,
  scope: {
    workspaceId: string;
    checkoutId: string;
    configurationRevisionId: string;
    configurationHash: string;
  },
  profile: any,
  resolved: any,
  context: ResolutionContext,
  logPath: string,
) {
  const inputHash = inputFingerprint(salt, {
    profile,
    configuration: scope.configurationHash,
    repository: await repositoryInputs(context.checkoutPath),
    resolved,
  });
  const matching = store
    .all("setup_receipts")
    .find(
      (r: any) =>
        r.workspaceId === scope.workspaceId &&
        r.checkoutId === scope.checkoutId &&
        r.logicalId === profile.id &&
        r.inputHash === inputHash &&
        r.state === "succeeded",
    );
  if (
    profile.runPolicy !== "always" &&
    matching &&
    (await successProbe(profile, resolved, context, matching.logPath))
  )
    return matching;
  const receipt = {
    id: randomUUID(),
    ...scope,
    logicalId: profile.id,
    inputHash,
    state: "running",
    startedAt: new Date().toISOString(),
    logPath,
    profile,
    dependencies: profile.dependsOn ?? [],
  };
  store.put("setup_receipts", receipt);
  try {
    await runCommand(
      resolved,
      resolved.cwd,
      resolved.env,
      logPath,
      context.secrets,
    );
    if (!(await successProbe(profile, resolved, context, logPath)))
      throw new DomainError(
        "DEPENDENCY_UNAVAILABLE",
        `Success probe failed: ${profile.id}`,
      );
    Object.assign(receipt, {
      state: "succeeded",
      completedAt: new Date().toISOString(),
    });
    store.put("setup_receipts", receipt);
    return receipt;
  } catch (e: any) {
    Object.assign(receipt, {
      state: "failed",
      completedAt: new Date().toISOString(),
      error: { code: e.code ?? "DEPENDENCY_UNAVAILABLE", message: e.message },
    });
    store.put("setup_receipts", receipt);
    throw e;
  }
}
