import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { RuntimeManager } from "../packages/controller/src/services/runtime.js";
class MemoryStore {
  rows = new Map<string, Map<string, any>>();
  get<T>(t: string, id: string): T | undefined {
    return this.rows.get(t)?.get(id);
  }
  all<T>(t: string): T[] {
    return [...(this.rows.get(t)?.values() ?? [])];
  }
  put(t: string, e: any) {
    if (!this.rows.has(t)) this.rows.set(t, new Map());
    this.rows.get(t)!.set(e.id, structuredClone(e));
  }
  delete(t: string, id: string) {
    this.rows.get(t)?.delete(id);
  }
}
export async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "wm-runtime-"));
  const store = new MemoryStore();
  const runtime = new RuntimeManager(store as any, root);
  const checkout = (id: string) =>
    ({
      id,
      workspaceId: id,
      repositoryKey: "app",
      path: root,
      sourceCommit: "base",
    }) as any;
  const workspace = (id: string) =>
    ({ id, projectId: "project", configurationRevisionId: "revision" }) as any;
  const revision = (extra: any = {}) =>
    ({
      id: "revision",
      hash: "v1",
      manifest: {
        schemaVersion: 1,
        name: "stack",
        repositories: [{ key: "app", path: "." }],
        prerequisites: [],
        setup: [],
        resources: [],
        services: [],
        bindings: {},
        entrypoints: [],
        ...extra,
      },
    }) as any;
  return {
    root,
    store,
    runtime,
    checkout,
    workspace,
    revision,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

// Accepting an adapter namespace mismatch would authorize cleanup of another resource.
test("command resources require namespace identity and retain external resources", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.root, "adapter.cjs"),
    `console.log(JSON.stringify({namespace:process.env.WORKTREE_RESOURCE_NAMESPACE,identity:'db-'+process.env.WORKTREE_RESOURCE_NAMESPACE,state:'ready',observedPorts:[],dataPaths:[],ownership:'owned'}))`,
  );
  const command = { executable: process.execPath, args: ["adapter.cjs"] };
  const resource = {
    id: "db",
    repository: "app",
    adapter: "command",
    args: [],
    cwd: ".",
    env: {},
    dependsOn: [],
    hooks: { start: command, status: command, stop: command, destroy: command },
    disposablePaths: [],
  };
  try {
    await f.runtime.start(
      f.workspace("one"),
      f.revision({ resources: [resource] }),
      [f.checkout("one")],
    );
    const row = f.runtime.listResources("one")[0]!;
    assert.equal(row.state, "ready");
    assert(row.identity.includes("one"));
    await writeFile(
      path.join(f.root, "adapter.cjs"),
      `console.log(JSON.stringify({namespace:'wrong',identity:'db-other',state:'ready',observedPorts:[],dataPaths:[],ownership:'owned'}))`,
    );
    await assert.rejects(
      f.runtime.stop("one"),
      (e: any) => e.code === "OWNERSHIP_UNVERIFIED",
    );
    await writeFile(
      path.join(f.root, "adapter.cjs"),
      `console.log(JSON.stringify({namespace:process.env.WORKTREE_RESOURCE_NAMESPACE,identity:'db-'+process.env.WORKTREE_RESOURCE_NAMESPACE,state:'ready',observedPorts:[],dataPaths:[],ownership:'owned'}))`,
    );
    await f.runtime.stop("one");
  } finally {
    await f.cleanup();
  }
});
// Deleting unpreviewed data, following escaping symlinks, or stopping external infrastructure must fail.
test("process resource Stop retains owned data and Destroy deletes only previewed disposable data", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.root, "db.cjs"),
    `require('fs').mkdirSync('db-data',{recursive:true});require('fs').writeFileSync('db-data/value','owned');require('http').createServer((q,r)=>r.end('db')).listen(+process.env.PORT,'127.0.0.1')`,
  );
  const resource = {
    id: "db",
    repository: "app",
    adapter: "process",
    executable: process.execPath,
    args: ["db.cjs"],
    cwd: ".",
    env: { PORT: "{{self.port}}" },
    dependsOn: [],
    port: { preferred: 25000, min: 25000, max: 25099 },
    disposablePaths: ["db-data"],
  };
  try {
    await f.runtime.start(
      f.workspace("one"),
      f.revision({ resources: [resource] }),
      [f.checkout("one")],
    );
    const owned = f.runtime.listResources("one")[0]!;
    await f.runtime.stop("one");
    assert.equal(
      await readFile(path.join(f.root, "db-data/value"), "utf8"),
      "owned",
    );
    await assert.rejects(
      f.runtime.destroy("one", undefined, { resources: [] }),
      (e: any) => e.code === "OWNERSHIP_UNVERIFIED",
    );
    assert.equal(
      await readFile(path.join(f.root, "db-data/value"), "utf8"),
      "owned",
    );
    await f.runtime.destroy("one", undefined, {
      resources: [
        {
          id: owned.id,
          identity: owned.identity,
          namespace: owned.namespace,
          disposablePaths: ["db-data"],
        },
      ],
    });
    await assert.rejects(
      readFile(path.join(f.root, "db-data/value")),
      (e: any) => e.code === "ENOENT",
    );
  } finally {
    await f.runtime.stop("one");
    await f.cleanup();
  }
});
// External resources are dependency observations; lifecycle operations must leave the server alive.
test("external resources remain running through Stop and Destroy", async () => {
  const { createServer } = await import("node:http");
  const external = createServer((q, r) => r.end("external"));
  await new Promise<void>((r) => external.listen(0, "127.0.0.1", r));
  const port = (external.address() as any).port;
  const f = await fixture();
  try {
    await f.runtime.start(
      f.workspace("one"),
      f.revision({
        resources: [
          {
            id: "shared",
            repository: "app",
            adapter: "external",
            args: [],
            cwd: ".",
            env: {},
            dependsOn: [],
            disposablePaths: [],
            url: `http://127.0.0.1:${port}`,
          },
        ],
      }),
      [f.checkout("one")],
    );
    await f.runtime.stop("one");
    const result = await f.runtime.destroy("one", undefined, { resources: [] });
    assert.equal(result.outcomes[0]!.status, "retained");
    assert.equal(
      await (await fetch(`http://127.0.0.1:${port}`)).text(),
      "external",
    );
  } finally {
    external.close();
    await f.cleanup();
  }
});
// Following declared data paths through symlinks could let project commands overwrite unrelated data.
test("escaping disposable-data symlinks are rejected before a resource process starts", async () => {
  const { symlink } = await import("node:fs/promises");
  const f = await fixture();
  const outside = await mkdtemp(path.join(tmpdir(), "wm-outside-"));
  await symlink(outside, path.join(f.root, "data"));
  try {
    await assert.rejects(
      f.runtime.start(
        f.workspace("one"),
        f.revision({
          resources: [
            {
              id: "db",
              repository: "app",
              adapter: "process",
              executable: process.execPath,
              args: ["-e", "setInterval(()=>{},1000)"],
              cwd: ".",
              env: {},
              dependsOn: [],
              disposablePaths: ["data"],
            },
          ],
        }),
        [f.checkout("one")],
      ),
      (e: any) => e.code === "INVALID_INPUT",
    );
  } finally {
    await f.runtime.stop("one");
    await f.cleanup();
    await rm(outside, { recursive: true, force: true });
  }
});
// Unknown ownership evidence must never become authority to call a cleanup hook.
test("an unverified command handle cannot invoke Stop even when its status hook claims ownership", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.root, "claim.cjs"),
    `require('fs').appendFileSync('called','x');console.log(JSON.stringify({namespace:process.env.WORKTREE_RESOURCE_NAMESPACE,identity:'claimed',state:'ready',ownership:'owned',observedPorts:[],dataPaths:[]}))`,
  );
  const hook = { executable: process.execPath, args: ["claim.cjs"] };
  const profile = {
    id: "db",
    repository: "app",
    adapter: "command",
    args: [],
    cwd: ".",
    env: {},
    dependsOn: [],
    hooks: { start: hook, status: hook, stop: hook, destroy: hook },
    disposablePaths: [],
  };
  f.store.put("workspaces", f.workspace("one"));
  f.store.put("configuration_revisions", f.revision({ resources: [profile] }));
  f.store.put("checkouts", f.checkout("one"));
  f.store.put("runtime_resources", {
    id: "unknown",
    workspaceId: "one",
    checkoutId: "one",
    configurationRevisionId: "revision",
    logicalId: "db",
    adapter: "command",
    namespace: "wm-one-one-db",
    ownership: "unknown",
    state: "unknown",
    profile,
    logPath: path.join(f.root, "logs"),
    dependencies: [],
  });
  try {
    await assert.rejects(
      f.runtime.stop("one"),
      (e: any) => e.code === "OWNERSHIP_UNVERIFIED",
    );
    await assert.rejects(
      readFile(path.join(f.root, "called")),
      (e: any) => e.code === "ENOENT",
    );
  } finally {
    await f.cleanup();
  }
});
// Adapter JSON reporting an assigned port is insufficient if no actual listener is reachable.
test("command resource readiness rejects a claimed but unpublished port", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.root, "claim-port.cjs"),
    `console.log(JSON.stringify({namespace:process.env.WORKTREE_RESOURCE_NAMESPACE,identity:'db',state:'ready',ownership:'owned',observedPorts:[+process.env.WORKTREE_RESOURCE_PORT],dataPaths:[]}))`,
  );
  const hook = { executable: process.execPath, args: ["claim-port.cjs"] };
  const profile = {
    id: "db",
    repository: "app",
    adapter: "command",
    args: [],
    cwd: ".",
    env: {},
    dependsOn: [],
    hooks: { start: hook, status: hook, stop: hook, destroy: hook },
    disposablePaths: [],
    port: { preferred: 25300, min: 25300, max: 25399 },
  };
  try {
    await assert.rejects(
      f.runtime.start(
        f.workspace("one"),
        f.revision({ resources: [profile] }),
        [f.checkout("one")],
      ),
      (e: any) => e.code === "DEPENDENCY_UNAVAILABLE",
    );
  } finally {
    await f.cleanup();
  }
});
