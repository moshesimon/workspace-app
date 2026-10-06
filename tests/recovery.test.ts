import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Controller } from "../packages/controller/src/controller.js";
test("restart reconciles journaled Git creation and removal without creating duplicate checkouts", async () => {
  const root = await mkdtemp(join(tmpdir(), "wm-recovery-")),
    repo = join(root, "repo"),
    state = join(root, "state");
  await mkdir(repo);
  await writeFile(join(repo, "readme"), "initial");
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync(
    "git",
    [
      "-C",
      repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=t@local",
      "commit",
      "-m",
      "first",
    ],
    { stdio: "ignore" },
  );
  let c = new Controller(state);
  try {
    const register = await c.call("projects.register", {
      root: repo,
      idempotencyKey: randomUUID(),
    });
    const p = (await c.operations.wait(register.id)).result.project;
    const created = await c.call("workspaces.create", {
      projectId: p.id,
      name: "Recovery",
      branch: "recovery",
      idempotencyKey: randomUUID(),
    });
    const result = await c.operations.wait(created.id);
    const checkout = result.result.checkouts[0];
    checkout.creationIntent = {
      branch: "recovery",
      sourceCommit: checkout.sourceCommit,
      path: checkout.path,
    };
    checkout.state = "creating";
    c.store.put("checkouts", checkout);
    c.close();
    c = new Controller(state);
    await c.call("controller.status");
    const recovered = await c.call("checkouts.get", {
      checkoutId: checkout.id,
    });
    assert.equal(recovered.state, "ready");
    assert.equal(recovered.originEvidence, "recorded");
    recovered.removalIntent = {
      path: recovered.path,
      at: new Date().toISOString(),
    };
    c.store.put("checkouts", recovered);
    execFileSync("git", ["-C", repo, "worktree", "remove", checkout.path]);
    c.close();
    c = new Controller(state);
    await c.call("controller.status");
    assert.ok(c.store.get<any>("checkouts", checkout.id).removedAt);
    assert.match(
      execFileSync("git", ["-C", repo, "branch", "--list", "recovery"], {
        encoding: "utf8",
      }),
      /recovery/,
    );
  } finally {
    c.close();
    await rm(root, { recursive: true, force: true });
  }
});
