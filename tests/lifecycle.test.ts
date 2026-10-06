import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Controller } from "../packages/controller/src/controller.js";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "wm-lifecycle-"));
  const repo = join(root, "project");
  await mkdir(repo);
  await writeFile(
    join(repo, "server.mjs"),
    `import http from 'node:http';http.createServer((q,r)=>r.end(process.env.MARKER)).listen(Number(process.env.PORT),'127.0.0.1')`,
  );
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
      "user.email=test@localhost",
      "commit",
      "-m",
      "initial",
    ],
    { stdio: "ignore" },
  );
  const c = new Controller(join(root, "state"));
  const manifest = {
    schemaVersion: 1,
    name: "Test project",
    repositories: [{ key: "app", path: ".", sourceRef: "main" }],
    services: [
      {
        id: "web",
        repository: "app",
        executable: process.execPath,
        args: ["server.mjs"],
        env: { PORT: "{{self.port}}", MARKER: "{{workspace.id}}" },
        port: { preferred: 23100, min: 23100, max: 23150 },
        readiness: { type: "http" },
      },
    ],
    entrypoints: [{ label: "App", service: "app/web" }],
  };
  async function act(name: string, input: any) {
    const op = await c.call(name, { ...input, idempotencyKey: randomUUID() });
    return c.operations.wait(op.id, 25000);
  }
  return {
    root,
    repo,
    c,
    manifest,
    act,
    async close() {
      for (const w of c.store.all("workspaces"))
        await c.runtime.stop(w.id).catch(() => {});
      c.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
test("controller creates two pinned workspaces, runs isolated instances, passively refreshes, stops one and preserves branches on destroy", async () => {
  const f = await fixture();
  try {
    const registration = await f.act("projects.register", {
      root: f.repo,
      manifest: f.manifest,
    });
    assert.equal(
      registration.status,
      "succeeded",
      JSON.stringify(registration.error),
    );
    const project = registration.result.project;
    const a = await f.act("workspaces.create", {
        projectId: project.id,
        name: "One",
        branch: "test-one",
      }),
      b = await f.act("workspaces.create", {
        projectId: project.id,
        name: "Two",
        branch: "test-two",
      });
    assert.equal(a.status, "succeeded");
    assert.equal(b.status, "succeeded");
    const wa = a.result.workspace,
      wb = b.result.workspace;
    const imported = await f.act("configuration.import", {
      projectId: project.id,
      manifest: { ...f.manifest, name: "New revision" },
    });
    assert.equal(
      f.c.store.get<any>("workspaces", wa.id).configurationRevisionId,
      wa.configurationRevisionId,
    );
    for (const workspaceId of [wa.id, wb.id]) {
      const start = await f.act("lifecycle.start", { workspaceId });
      assert.equal(start.status, "succeeded", JSON.stringify(start.error));
    }
    const sa = f.c.runtime.listServices(wa.id)[0],
      sb = f.c.runtime.listServices(wb.id)[0];
    assert.notEqual(sa.assignedPort, sb.assignedPort);
    assert.equal(await fetch(sa.url).then((r) => r.text()), wa.id);
    assert.equal(await fetch(sb.url).then((r) => r.text()), wb.id);
    const pid = sb.pid;
    await f.act("lifecycle.refresh", { workspaceId: wb.id });
    assert.equal(f.c.runtime.listServices(wb.id)[0].pid, pid);
    const apply = await f.act("configuration.apply", {
      workspaceId: wa.id,
      revisionId: imported.result.id,
    });
    assert.equal(apply.status, "failed");
    assert.equal(
      (await f.act("lifecycle.stop", { workspaceId: wa.id })).status,
      "succeeded",
    );
    assert.equal(await fetch(sb.url).then((r) => r.text()), wb.id);
    const preview = await f.c.call("destroy.preview", { workspaceId: wa.id });
    const destroy = await f.act("destroy.execute", {
      previewId: preview.id,
      discardChanges: false,
    });
    assert.equal(destroy.status, "succeeded", JSON.stringify(destroy));
    assert.equal(
      execFileSync("git", ["-C", f.repo, "branch", "--list", "test-one"], {
        encoding: "utf8",
      }).trim(),
      "test-one",
    );
  } finally {
    await f.close();
  }
});
test("controller refuses dirty discard and stale preview across transports", async () => {
  const f = await fixture();
  try {
    const p = (
      await f.act("projects.register", { root: f.repo, manifest: f.manifest })
    ).result.project;
    const result = await f.act("workspaces.create", {
      projectId: p.id,
      name: "Dirty",
      branch: "dirty",
    });
    const w = result.result.workspace,
      c = result.result.checkouts[0];
    await writeFile(join(c.path, "new.txt"), "important");
    const preview = await f.c.call("destroy.preview", { workspaceId: w.id });
    assert.equal(
      (
        await f.act("destroy.execute", {
          previewId: preview.id,
          discardChanges: false,
        })
      ).error?.code,
      "DIRTY_CHECKOUT",
    );
    await writeFile(join(c.path, "new.txt"), "changed");
    assert.equal(
      (
        await f.act("destroy.execute", {
          previewId: preview.id,
          discardChanges: true,
        })
      ).error?.code,
      "STALE_PREVIEW",
    );
    assert.equal(await readFile(join(c.path, "new.txt"), "utf8"), "changed");
  } finally {
    await f.close();
  }
});
test("controller destroys declared resource data before removing checkout and retains unrelated branches", async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.repo, "data.mjs"),
      `import http from 'node:http';import{mkdirSync,writeFileSync}from'node:fs';mkdirSync('.data',{recursive:true});writeFileSync('.data/value','instance');http.createServer((q,r)=>r.end('ok')).listen(Number(process.env.PORT),'127.0.0.1');`,
    );
    await writeFile(join(f.repo, ".gitignore"), ".data/\n");
    execFileSync("git", ["-C", f.repo, "add", "."]);
    execFileSync(
      "git",
      [
        "-C",
        f.repo,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@localhost",
        "commit",
        "-m",
        "Data service",
      ],
      { stdio: "ignore" },
    );
    const manifest = {
      ...f.manifest,
      services: [],
      resources: [
        {
          id: "db",
          repository: "app",
          adapter: "process",
          executable: process.execPath,
          args: ["data.mjs"],
          env: { PORT: "{{self.port}}" },
          port: { preferred: 23500, min: 23500, max: 23520 },
          disposablePaths: [".data"],
        },
      ],
      entrypoints: [],
    };
    const p = (await f.act("projects.register", { root: f.repo, manifest }))
      .result.project;
    const created = await f.act("workspaces.create", {
      projectId: p.id,
      name: "Resource",
      branch: "with-resource",
    });
    const w = created.result.workspace;
    const start = await f.act("lifecycle.start", { workspaceId: w.id });
    assert.equal(start.status, "succeeded", JSON.stringify(start.error));
    const preview = await f.c.call("destroy.preview", { workspaceId: w.id });
    assert.equal(preview.targets[0].dirty, false);
    await writeFile(
      join(created.result.checkouts[0].path, ".data/value"),
      "churn",
    );
    const destroy = await f.act("destroy.execute", {
      previewId: preview.id,
      discardChanges: false,
    });
    assert.equal(destroy.status, "succeeded", JSON.stringify(destroy));
    assert.match(
      execFileSync("git", ["-C", f.repo, "branch", "--list", "with-resource"], {
        encoding: "utf8",
      }),
      /with-resource/,
    );
  } finally {
    await f.close();
  }
});
test("portable projects rebind to a moved root while preserving configuration revision", async () => {
  const f = await fixture();
  try {
    const p = (
      await f.act("projects.register", { root: f.repo, manifest: f.manifest })
    ).result.project;
    const { rename } = await import("node:fs/promises");
    const moved = join(f.root, "moved");
    await rename(f.repo, moved);
    const result = await f.act("projects.rebind", {
      projectId: p.id,
      root: moved,
    });
    assert.equal(result.status, "succeeded", JSON.stringify(result.error));
    assert.equal(
      result.result.root,
      await (await import("node:fs/promises")).realpath(moved),
    );
    assert.equal(
      result.result.configurationRevisionId,
      p.configurationRevisionId,
    );
    const created = await f.act("workspaces.create", {
      projectId: p.id,
      name: "Moved",
      branch: "moved",
    });
    assert.equal(created.status, "succeeded", JSON.stringify(created));
    const refuse = await f.act("projects.rebind", {
      projectId: p.id,
      root: moved,
    });
    assert.equal(refuse.status, "failed");
    assert.equal(refuse.error?.code, "OPERATION_CONFLICT");
  } finally {
    await f.close();
  }
});
