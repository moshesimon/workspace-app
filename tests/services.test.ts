import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
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
// Removing workspace URL isolation or skipping occupied-port checks must fail this test.
test("two stacks receive distinct ports and route to their own API while retaining unrelated listeners", async () => {
  const f = await fixture();
  const occupant = net.createServer();
  await new Promise<void>((r) => occupant.listen(0, "127.0.0.1", r));
  const busy = (occupant.address() as net.AddressInfo).port;
  await writeFile(
    path.join(f.root, "api.cjs"),
    `require('http').createServer((q,r)=>r.end(process.env.MARKER)).listen(+process.env.PORT,'127.0.0.1')`,
  );
  await writeFile(
    path.join(f.root, "ui.cjs"),
    `require('http').createServer(async(q,r)=>r.end(await(await fetch(process.env.API)).text())).listen(+process.env.PORT,'127.0.0.1')`,
  );
  const profile = (id: string) => ({
    id,
    repository: "app",
    executable: process.execPath,
    args: [id + ".cjs"],
    cwd: ".",
    env: {
      PORT: "{{self.port}}",
      MARKER: "{{workspace.id}}",
      API: "{{service.api.url}}",
    },
    dependsOn: id === "ui" ? ["service:app/api"] : [],
    runtimePaths: [],
    port: { preferred: busy, min: busy, max: Math.min(65535, busy + 40) },
    readiness: { type: "http", timeoutMs: 3000 },
  });
  const revision = f.revision({ services: [profile("ui"), profile("api")] });
  try {
    await f.runtime.start(f.workspace("one"), revision, [f.checkout("one")]);
    await f.runtime.start(f.workspace("two"), revision, [f.checkout("two")]);
    const one = f.runtime.listServices("one");
    const two = f.runtime.listServices("two");
    assert.equal(
      await (
        await fetch(one.find((s: any) => s.logicalId === "ui")!.url!)
      ).text(),
      "one",
    );
    assert.equal(
      await (
        await fetch(two.find((s: any) => s.logicalId === "ui")!.url!)
      ).text(),
      "two",
    );
    assert.equal(new Set([...one, ...two].map((s) => s.assignedPort)).size, 4);
    assert(occupant.listening);
    await f.runtime.stop("one");
    assert.equal(
      await (
        await fetch(two.find((s: any) => s.logicalId === "api")!.url!)
      ).text(),
      "two",
    );
    assert(occupant.listening);
  } finally {
    await f.runtime.stop("one");
    await f.runtime.stop("two");
    occupant.close();
    await f.cleanup();
  }
});
// A forged persisted process identity must never cause a signal to an unrelated PID.
test("stop refuses a reused or unverified PID", async () => {
  const f = await fixture();
  try {
    f.store.put("service_instances", {
      id: "forged",
      workspaceId: "one",
      checkoutId: "one",
      logicalId: "api",
      state: "ready",
      pid: process.pid,
      startIdentity: "wrong",
      processGroup: process.pid,
      dependencies: [],
    });
    await assert.rejects(
      f.runtime.stop("one"),
      (e: any) => e.code === "OWNERSHIP_UNVERIFIED",
    );
    assert.equal(
      f.store.get<any>("service_instances", "forged")!.state,
      "unknown",
    );
  } finally {
    await f.cleanup();
  }
});
// Omitting dependency health propagation or exposing declared secrets must fail this test.
test("Refresh degrades dependent services and service logs redact declared secrets", async () => {
  const f = await fixture();
  const secret = "runtime-secret-DoNotExpose";
  process.env.WM_RUNTIME_TEST_SECRET = secret;
  await writeFile(
    path.join(f.root, "server.cjs"),
    `console.log(process.env.TOKEN);require('http').createServer((q,r)=>r.end(process.env.MARKER)).listen(+process.env.PORT,'127.0.0.1')`,
  );
  const profile = (id: string) => ({
    id,
    repository: "app",
    executable: process.execPath,
    args: ["server.cjs"],
    cwd: ".",
    env: {
      PORT: "{{self.port}}",
      MARKER: id,
      TOKEN: "{{secret.WM_RUNTIME_TEST_SECRET}}",
    },
    dependsOn: id === "ui" ? ["service:app/api"] : [],
    runtimePaths: [],
    port: {
      preferred: id === "api" ? 24500 : 24600,
      min: id === "api" ? 24500 : 24600,
      max: id === "api" ? 24599 : 24699,
    },
    readiness: { type: "http", timeoutMs: 2000 },
  });
  try {
    await f.runtime.start(
      f.workspace("one"),
      f.revision({ services: [profile("api"), profile("ui")] }),
      [f.checkout("one")],
    );
    const api = f.runtime
      .listServices("one")
      .find((s) => s.logicalId === "api")!;
    assert(!f.runtime.logs(api.id).text.includes(secret));
    assert(f.runtime.logs(api.id).text.includes("[REDACTED]"));
    await f.runtime.stop("one", undefined, api.id);
    await f.runtime.refresh("one");
    const ui = f.runtime.listServices("one").find((s) => s.logicalId === "ui")!;
    assert.equal(ui.state, "degraded");
    assert.equal(
      api.id,
      f.runtime.listServices("one").find((s) => s.logicalId === "api")!.id,
    );
  } finally {
    await f.runtime.stop("one");
    delete process.env.WM_RUNTIME_TEST_SECRET;
    await f.cleanup();
  }
});
// Cleaning up a failed attempt must preserve services running before that attempt.
test("a failed Start preserves preexisting processes and refuses an unexpected listening port", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.root, "good.cjs"),
    `require('http').createServer((q,r)=>r.end('good')).listen(+process.env.PORT,'127.0.0.1')`,
  );
  await writeFile(
    path.join(f.root, "bad.cjs"),
    `require('http').createServer((q,r)=>r.end('bad')).listen(0,'127.0.0.1')`,
  );
  const profile = (id: string) => ({
    id,
    repository: "app",
    executable: process.execPath,
    args: [id + ".cjs"],
    cwd: ".",
    env: { PORT: "{{self.port}}" },
    dependsOn: [],
    runtimePaths: [],
    port: {
      preferred: id === "good" ? 24700 : 24800,
      min: id === "good" ? 24700 : 24800,
      max: id === "good" ? 24799 : 24899,
    },
    readiness: { type: "http", timeoutMs: 500 },
  });
  try {
    const initial = f.revision({ services: [profile("good")] });
    await f.runtime.start(f.workspace("one"), initial, [f.checkout("one")]);
    const good = f.runtime.listServices("one")[0]!;
    const extended = f.revision({
      services: [profile("good"), profile("bad")],
    });
    await assert.rejects(
      f.runtime.start(f.workspace("one"), extended, [f.checkout("one")]),
      (e: any) => e.code === "DEPENDENCY_UNAVAILABLE",
    );
    assert.equal(await (await fetch(good.url!)).text(), "good");
    assert.equal(
      f.runtime.listServices("one").find((s) => s.logicalId === "bad")!.state,
      "failed",
    );
  } finally {
    await f.runtime.stop("one");
    await f.cleanup();
  }
});
// Restart recovery must inspect persisted identity and reuse, rather than duplicate, a live process.
test("a new manager safely reuses a persisted live service without relaunching it", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.root, "recover.cjs"),
    `require('http').createServer((q,r)=>r.end('recovered')).listen(+process.env.PORT,'127.0.0.1')`,
  );
  const revision = f.revision({
    services: [
      {
        id: "api",
        repository: "app",
        executable: process.execPath,
        args: ["recover.cjs"],
        cwd: ".",
        env: { PORT: "{{self.port}}" },
        dependsOn: [],
        runtimePaths: [],
        port: { preferred: 24900, min: 24900, max: 24999 },
        readiness: { type: "http", timeoutMs: 2000 },
      },
    ],
  });
  f.store.put("workspaces", f.workspace("one"));
  f.store.put("configuration_revisions", revision);
  f.store.put("checkouts", f.checkout("one"));
  try {
    await f.runtime.start(f.workspace("one"), revision, [f.checkout("one")]);
    const original = f.runtime.listServices("one")[0]!;
    const recovered = new RuntimeManager(f.store as any, f.root);
    await recovered.start(f.workspace("one"), revision, [f.checkout("one")]);
    assert.equal(recovered.listServices("one")[0]!.pid, original.pid);
    assert.equal(recovered.listServices("one").length, 1);
    await recovered.stop("one");
  } finally {
    await f.runtime.stop("one");
    await f.cleanup();
  }
});
// A service spawning children must not leave those children running after Stop when they ignore SIGTERM.
test("Stop waits for the owned process group and terminates surviving children", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.root, "group.cjs"),
    `const fs=require('fs');const child=require('child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync('child.pid',String(child.pid));require('http').createServer((q,r)=>r.end('group')).listen(+process.env.PORT,'127.0.0.1')`,
  );
  const revision = f.revision({
    services: [
      {
        id: "api",
        repository: "app",
        executable: process.execPath,
        args: ["group.cjs"],
        cwd: ".",
        env: { PORT: "{{self.port}}" },
        dependsOn: [],
        runtimePaths: [],
        port: { preferred: 25100, min: 25100, max: 25199 },
        readiness: { type: "http", timeoutMs: 2000 },
      },
    ],
  });
  const { readFile } = await import("node:fs/promises");
  const { processIdentity } =
    await import("../packages/controller/src/services/platform/macos.js");
  let childPid: number | undefined;
  try {
    await f.runtime.start(f.workspace("one"), revision, [f.checkout("one")]);
    childPid = Number(await readFile(path.join(f.root, "child.pid"), "utf8"));
    await f.runtime.stop("one");
    assert.equal(await processIdentity(childPid), null);
  } finally {
    if (childPid && (await processIdentity(childPid))) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {}
    }
    await f.runtime.stop("one");
    await f.cleanup();
  }
});
// Finite-command timeout must wait for verified group cleanup instead of scheduling an unchecked later signal.
test("timed-out setup commands clean up their verified process group and retain unrelated listeners", async () => {
  const f = await fixture();
  const occupant = net.createServer();
  await new Promise<void>((r) => occupant.listen(0, "127.0.0.1", r));
  await writeFile(
    path.join(f.root, "timeout.cjs"),
    `const child=require('child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});require('fs').writeFileSync('child.pid',String(child.pid));setInterval(()=>{},1000)`,
  );
  const { runCommand } =
    await import("../packages/controller/src/services/processes.js");
  const { processIdentity } =
    await import("../packages/controller/src/services/platform/macos.js");
  const { readFile } = await import("node:fs/promises");
  let childPid: number | undefined;
  try {
    await assert.rejects(
      runCommand(
        { executable: process.execPath, args: ["timeout.cjs"] },
        f.root,
        {},
        path.join(f.root, "command.log"),
        new Set(),
        500,
      ),
      (e: any) => e.code === "DEPENDENCY_UNAVAILABLE",
    );
    childPid = Number(await readFile(path.join(f.root, "child.pid"), "utf8"));
    assert.equal(await processIdentity(childPid), null);
    assert(occupant.listening);
  } finally {
    if (childPid && (await processIdentity(childPid))) {
      try {
        process.kill(childPid, "SIGKILL");
      } catch {}
    }
    occupant.close();
    await f.cleanup();
  }
});
// Restarting a service with changed secret input must not expose the previous raw buffered log.
test("service log redaction remains intact when local secret values change", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.root, "secret.cjs"),
    `console.log(process.env.TOKEN);require('http').createServer((q,r)=>r.end('ok')).listen(+process.env.PORT,'127.0.0.1')`,
  );
  const revision = f.revision({
    services: [
      {
        id: "api",
        repository: "app",
        executable: process.execPath,
        args: ["secret.cjs"],
        cwd: ".",
        env: { PORT: "{{self.port}}", TOKEN: "{{secret.WM_CHANGE_SECRET}}" },
        dependsOn: [],
        runtimePaths: [],
        port: { preferred: 25400, min: 25400, max: 25499 },
        readiness: { type: "http", timeoutMs: 2000 },
      },
    ],
  });
  try {
    process.env.WM_CHANGE_SECRET = "first-private-secret";
    await f.runtime.start(f.workspace("one"), revision, [f.checkout("one")]);
    await f.runtime.stop("one");
    process.env.WM_CHANGE_SECRET = "second-private-secret";
    await f.runtime.start(f.workspace("one"), revision, [f.checkout("one")]);
    const logs = f.runtime.logs(f.runtime.listServices("one")[0]!.id).text;
    assert(!logs.includes("first-private-secret"));
    assert(!logs.includes("second-private-secret"));
  } finally {
    await f.runtime.stop("one");
    delete process.env.WM_CHANGE_SECRET;
    await f.cleanup();
  }
});
// Wrapper roots must attribute readiness to verified descendants and never include unrelated listeners.
test("a foreground wrapper attributes child HTTP listeners and Stop removes only its owned group", async () => {
  const f = await fixture();
  const occupant = net.createServer();
  await new Promise<void>((r) => occupant.listen(0, "127.0.0.1", r));
  const unrelatedPort = (occupant.address() as net.AddressInfo).port;
  await writeFile(
    path.join(f.root, "http-child.cjs"),
    `const http=require('http');http.createServer((q,r)=>r.end('wrapped')).listen(+process.env.PORT,'127.0.0.1');http.createServer((q,r)=>r.end('extra')).listen(0,'127.0.0.1');`,
  );
  await writeFile(
    path.join(f.root, "wrapper.cjs"),
    `const child=require('child_process').spawn(process.execPath,['http-child.cjs'],{stdio:['ignore','inherit','inherit']});require('fs').writeFileSync('wrapped-child.pid',String(child.pid));child.on('exit',()=>process.exit());setInterval(()=>{},1000);`,
  );
  const revision = f.revision({
    services: [
      {
        id: "api",
        repository: "app",
        executable: process.execPath,
        args: ["wrapper.cjs"],
        cwd: ".",
        env: { PORT: "{{self.port}}" },
        dependsOn: [],
        runtimePaths: [],
        port: { preferred: 25500, min: 25500, max: 25599 },
        readiness: { type: "http", timeoutMs: 1200 },
      },
    ],
  });
  const { readFile } = await import("node:fs/promises");
  const { processIdentity, listenerPorts, processGroupMembers } =
    await import("../packages/controller/src/services/platform/macos.js");
  try {
    await f.runtime.start(f.workspace("one"), revision, [f.checkout("one")]);
    const row = f.runtime.listServices("one")[0]!;
    const childPid = Number(
      await readFile(path.join(f.root, "wrapped-child.pid"), "utf8"),
    );
    assert.deepEqual(await listenerPorts(row.pid), []);
    assert.equal(await (await fetch(row.url!)).text(), "wrapped");
    assert.equal(row.observedPorts.length, 2);
    assert(row.observedPorts.includes(row.assignedPort));
    assert(!row.observedPorts.includes(unrelatedPort));
    assert(
      row.observedProcesses.some(
        (p: any) => p.pid === childPid && p.startIdentity,
      ),
    );
    assert(!row.observedProcesses.some((p: any) => p.pid === process.pid));
    await f.runtime.stop("one");
    assert.equal(await processIdentity(childPid), null);
    assert.deepEqual(await processGroupMembers(row.processGroup), []);
    assert(occupant.listening);
  } finally {
    await f.runtime.stop("one");
    occupant.close();
    await f.cleanup();
  }
});
