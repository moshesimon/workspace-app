import { lstat } from "node:fs/promises";
import type { Store } from "../store.js";
import type { Checkout, Repository } from "../../../contracts/src/models.js";
import { discoverWorktrees, verifyRepository } from "../git/worktrees.js";
import { resolveCommit } from "../git/command.js";
import { errorRecord } from "../../../contracts/src/errors.js";
/** Reconcile only previously journaled paths; discovered directories never become owned. */
export async function reconcileGit(store: Store) {
  for (const checkout of store.all<Checkout>("checkouts")) {
    if (
      checkout.removedAt ||
      (!checkout.creationIntent && !checkout.removalIntent)
    )
      continue;
    try {
      const repository = store.get<Repository>(
        "repositories",
        checkout.repositoryId,
      );
      if (!repository) continue;
      await verifyRepository(repository);
      const registered = (await discoverWorktrees(repository.path)).find(
        (w) => w.path === checkout.path,
      );
      if (checkout.removalIntent) {
        let exists = true;
        try {
          await lstat(checkout.path);
        } catch (e: any) {
          if (e.code === "ENOENT") exists = false;
          else throw e;
        }
        if (!registered && !exists) {
          checkout.removedAt = new Date().toISOString();
          checkout.state = "removed";
          checkout.recoveredAt = checkout.removedAt;
          store.put("checkouts", checkout);
        }
        continue;
      }
      if (checkout.state !== "creating") continue;
      const intent = checkout.creationIntent;
      if (
        registered &&
        !registered.main &&
        registered.branch === intent.branch &&
        registered.path === intent.path &&
        (await resolveCommit(checkout.path, "HEAD")) === intent.sourceCommit
      ) {
        checkout.state = "ready";
        checkout.currentBranch = registered.branch;
        checkout.recoveredAt = new Date().toISOString();
        delete checkout.creationError;
      } else {
        checkout.state = "recovery-required";
        checkout.creationError = {
          code: "OWNERSHIP_UNVERIFIED",
          message:
            "Interrupted checkout creation could not be matched to its recorded path, branch and source. Inspect it before adoption.",
        };
      }
      store.put("checkouts", checkout);
    } catch (error) {
      checkout.recoveryError = errorRecord(error);
      store.put("checkouts", checkout);
    }
  }
  for (const workspace of store.all("workspaces")) {
    const checkouts = store
      .all<Checkout>("checkouts")
      .filter((c) => c.workspaceId === workspace.id);
    if (checkouts.length && checkouts.every((c) => c.removedAt)) {
      workspace.state = "removed";
      workspace.removedAt ??= new Date().toISOString();
      store.put("workspaces", workspace);
    }
  }
}
