import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
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

// Reusing receipts after source/input changes, or treating a missing secret as empty, must fail.
test("preparation reuses matching receipts and invalidates source inputs while reporting missing secrets", async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, "input.txt"), "one");
  const recipe = {
    id: "prepare",
    repository: "app",
    executable: process.execPath,
    args: ["-e", `require('fs').appendFileSync('runs','x')`],
    cwd: ".",
    env: {},
    dependsOn: [],
    runPolicy: "oncePerInputs",
    probe: {
      executable: process.execPath,
      args: ["-e", `process.exit(require('fs').existsSync('runs')?0:1)`],
    },
  };
  try {
    await f.runtime.prepare(
      f.workspace("one"),
      f.revision({ setup: [recipe] }),
      [f.checkout("one")],
    );
    await f.runtime.prepare(
      f.workspace("one"),
      f.revision({ setup: [recipe] }),
      [f.checkout("one")],
    );
    assert.equal(await readFile(path.join(f.root, "runs"), "utf8"), "x");
    await writeFile(path.join(f.root, "input.txt"), "two");
    await f.runtime.prepare(
      f.workspace("one"),
      f.revision({ setup: [recipe] }),
      [f.checkout("one")],
    );
    assert.equal(await readFile(path.join(f.root, "runs"), "utf8"), "xx");
    const secretRecipe = {
      ...recipe,
      id: "secret",
      env: { TOKEN: "{{secret.WM_TEST_MISSING_SECRET}}" },
    };
    delete process.env.WM_TEST_MISSING_SECRET;
    await assert.rejects(
      f.runtime.prepare(
        f.workspace("one"),
        f.revision({ setup: [secretRecipe] }),
        [f.checkout("one")],
      ),
      (e: any) => e.code === "SETUP_INPUT_REQUIRED",
    );
  } finally {
    await f.cleanup();
  }
});
// Interrupted receipts or broken success probes must never be reused as completed setup.
test("interrupted preparation remains failed and failed success probes trigger new preparation", async () => {
  const f = await fixture();
  const recipe = {
    id: "prepare",
    repository: "app",
    executable: process.execPath,
    args: [
      "-e",
      `require('fs').writeFileSync('ready','yes');require('fs').appendFileSync('runs','x')`,
    ],
    cwd: ".",
    env: {},
    dependsOn: [],
    runPolicy: "oncePerInputs",
    probe: {
      executable: process.execPath,
      args: ["-e", `process.exit(require('fs').existsSync('ready')?0:1)`],
    },
  };
  try {
    f.store.put("setup_receipts", {
      id: "interrupted",
      workspaceId: "one",
      state: "running",
    });
    const recovered = new RuntimeManager(f.store as any, f.root);
    assert.equal(recovered.listSetup("one")[0]!.state, "failed");
    await recovered.prepare(
      f.workspace("one"),
      f.revision({ setup: [recipe] }),
      [f.checkout("one")],
    );
    await rm(path.join(f.root, "ready"));
    await recovered.prepare(
      f.workspace("one"),
      f.revision({ setup: [recipe] }),
      [f.checkout("one")],
    );
    assert.equal(await readFile(path.join(f.root, "runs"), "utf8"), "xx");
  } finally {
    await f.cleanup();
  }
});
// Port changes embedded in preparation must invalidate receipts even if repository inputs are unchanged.
test("preparation fingerprints include the reserved future service URLs", async () => {
  const f = await fixture();
  const recipe = {
    id: "prepare",
    repository: "app",
    executable: process.execPath,
    args: ["-e", `require('fs').appendFileSync('urls',process.env.API+'\\n')`],
    cwd: ".",
    env: { API: "{{service.api.url}}" },
    dependsOn: [],
    runPolicy: "oncePerInputs",
  };
  const service = {
    id: "api",
    repository: "app",
    executable: process.execPath,
    args: ["-e", "setInterval(()=>{},1000)"],
    cwd: ".",
    env: { PORT: "{{self.port}}" },
    dependsOn: [],
    runtimePaths: [],
    port: { preferred: 25200, min: 25200, max: 25299 },
    readiness: { type: "tcp" },
  };
  let occupant: any;
  try {
    await f.runtime.prepare(
      f.workspace("one"),
      f.revision({ setup: [recipe], services: [service] }),
      [f.checkout("one")],
    );
    await f.runtime.prepare(
      f.workspace("one"),
      f.revision({ setup: [recipe], services: [service] }),
      [f.checkout("one")],
    );
    const previous = f.runtime.listServices("one")[0]!.assignedPort;
    const { createServer } = await import("node:net");
    occupant = createServer();
    await new Promise<void>((r) => occupant.listen(previous, "127.0.0.1", r));
    await f.runtime.prepare(
      f.workspace("one"),
      f.revision({ setup: [recipe], services: [service] }),
      [f.checkout("one")],
    );
    const urls = (await readFile(path.join(f.root, "urls"), "utf8"))
      .trim()
      .split("\n");
    assert.equal(urls.length, 2);
    assert.notEqual(urls[0], urls[1]);
    assert(occupant.listening);
  } finally {
    occupant?.close();
    await f.runtime.stop("one");
    await f.cleanup();
  }
});
