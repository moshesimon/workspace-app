import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../packages/controller/src/server.js";
import { ControllerClient } from "../packages/client/src/connect.js";
test("concurrent clients share a private controller socket and validated protocol", async () => {
  const root = await mkdtemp(join(tmpdir(), "wm-ipc-"));
  const server = await startServer({
    stateRoot: root,
    dispatch: async (name) => {
      if (name === "controller.status")
        return { protocolVersion: 1, pid: process.pid };
      throw Error("no");
    },
  });
  try {
    const clients = Array.from({ length: 8 }, () => new ControllerClient(root));
    const records = await Promise.all(
      clients.map((c) => c.call("controller.status", {})),
    );
    assert.equal(new Set(records.map((r) => r.pid)).size, 1);
    assert.equal((await stat(server.socketPath)).mode & 0o777, 0o600);
    await assert.rejects(clients[0].call("unknown", {}));
    await assert.rejects(
      startServer({ stateRoot: root, dispatch: async () => ({}) }),
      /already running/,
    );
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

// Removing atomic singleton acquisition must allow a stale contender to remove
// another starter's endpoint. Both the winner's lock and socket must survive.
test("eight simultaneous stale-lock starters retain exactly one owner and endpoint", async () => {
  const { mkdir, writeFile, readFile, access } =
    await import("node:fs/promises");
  const { connectionPaths } = await import("../packages/client/src/paths.js");
  const root = await mkdtemp(join(tmpdir(), "wm-stale-race-"));
  const paths = connectionPaths(root);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await writeFile(
    paths.lock,
    JSON.stringify({ pid: 2147483647, startIdentity: "dead" }),
    { mode: 0o600 },
  );
  const attempts = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      startServer({
        stateRoot: root,
        dispatch: async () => ({ protocolVersion: 1, pid: process.pid }),
      }),
    ),
  );
  const owners = attempts.filter(
    (
      result,
    ): result is PromiseFulfilledResult<
      Awaited<ReturnType<typeof startServer>>
    > => result.status === "fulfilled",
  );
  try {
    assert.equal(owners.length, 1);
    await access(join(paths.directory, "singleton.sqlite"));
    assert.equal(
      JSON.parse(await readFile(paths.lock, "utf8")).pid,
      process.pid,
    );
    const client = new ControllerClient(root);
    assert.equal((await client.call("controller.status")).pid, process.pid);
    assert.equal(
      attempts.filter((result) => result.status === "rejected").length,
      7,
    );
  } finally {
    await Promise.all(owners.map((result) => result.value.close()));
    await rm(root, { recursive: true, force: true });
    await rm(paths.directory, { recursive: true, force: true });
  }
});

// Removing client heartbeat closes a controller while its desktop/agent client
// is still alive; removing dispose prevents it from becoming idle afterward.
test("live client heartbeat retains idle controller and dispose permits shutdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "wm-heartbeat-"));
  const server = await startServer({
    stateRoot: root,
    idle: () => true,
    idleMs: 60,
    dispatch: async () => ({ protocolVersion: 1 }),
  });
  const client = new (ControllerClient as any)(root, { keepAliveMs: 10 });
  try {
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.equal(server.server.listening, true);
    client.dispose();
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.equal(server.server.listening, false);
  } finally {
    client.dispose?.();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

// Removing safe reconnection leaves the same client unable to recover from a
// stopped controller. Concurrent calls must share one restart rather than race.
test("client reconnects concurrent safe failures once after controller restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "wm-reconnect-"));
  let server = await startServer({
    stateRoot: root,
    dispatch: async () => ({ protocolVersion: 1, generation: 1 }),
  });
  let reconnects = 0;
  const client = new (ControllerClient as any)(root, {
    reconnect: async () => {
      reconnects++;
      server = await startServer({
        stateRoot: root,
        dispatch: async () => ({ protocolVersion: 1, generation: 2 }),
      });
    },
  });
  try {
    assert.equal((await client.call("controller.status")).generation, 1);
    await server.close();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => client.call("controller.status")),
    );
    assert.equal(reconnects, 1);
    assert.ok(results.every((result) => result.generation === 2));
  } finally {
    client.dispose?.();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("server rejects a singleton database symlink without touching its target", async () => {
  const { mkdir, writeFile, symlink, readFile } =
    await import("node:fs/promises");
  const { connectionPaths } = await import("../packages/client/src/paths.js");
  const root = await mkdtemp(join(tmpdir(), "wm-symlink-"));
  const paths = connectionPaths(root);
  const target = join(root, "untouched");
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await writeFile(target, "keep");
  await symlink(target, join(paths.directory, "singleton.sqlite"));
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await assert.rejects(async () => {
      server = await startServer({
        stateRoot: root,
        dispatch: async () => ({}),
      });
    }, /owned|ownership|symlink/i);
    assert.equal(await readFile(target, "utf8"), "keep");
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
    await rm(paths.directory, { recursive: true, force: true });
  }
});

test("controller domain failures never trigger client restart or retry", async () => {
  const { DomainError } = await import("../packages/contracts/src/errors.js");
  const root = await mkdtemp(join(tmpdir(), "wm-domain-"));
  let calls = 0,
    reconnects = 0;
  const server = await startServer({
    stateRoot: root,
    dispatch: async () => {
      calls++;
      throw new DomainError("INVALID_INPUT", "invalid configuration");
    },
  });
  const client = new (ControllerClient as any)(root, {
    reconnect: async () => {
      reconnects++;
    },
  });
  try {
    await assert.rejects(
      client.call("projects.register", { root, idempotencyKey: "same-key" }),
      /invalid configuration/,
    );
    assert.equal(calls, 1);
    assert.equal(reconnects, 0);
  } finally {
    client.dispose?.();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("ambiguous disconnect retries only with the exact same idempotency input", async () => {
  const { createServer } = await import("node:net");
  const { mkdir } = await import("node:fs/promises");
  const { connectionPaths } = await import("../packages/client/src/paths.js");
  for (const keyed of [false, true]) {
    const root = await mkdtemp(join(tmpdir(), "wm-ambiguous-"));
    const paths = connectionPaths(root);
    await mkdir(paths.directory, { recursive: true, mode: 0o700 });
    let requests: any[] = [];
    let reconnects = 0;
    const server = createServer((socket) =>
      socket.on("data", (chunk) => {
        const request = JSON.parse(chunk.toString());
        requests.push(request.input);
        if (requests.length === 1) socket.destroy();
        else
          socket.end(
            JSON.stringify({ id: request.id, result: { created: true } }) +
              "\n",
          );
      }),
    );
    await new Promise<void>((resolve) => server.listen(paths.socket, resolve));
    const client = new (ControllerClient as any)(root, {
      reconnect: async () => {
        reconnects++;
      },
    });
    const input = {
      root,
      ...(keyed ? { idempotencyKey: "stable-operation-key" } : {}),
    };
    try {
      if (keyed) {
        assert.deepEqual(await client.call("projects.register", input), {
          created: true,
        });
        assert.equal(requests.length, 2);
        assert.deepEqual(requests[0], requests[1]);
        assert.equal(reconnects, 1);
      } else {
        await assert.rejects(
          client.call("projects.register", input),
          /closed|disconnected/i,
        );
        assert.equal(requests.length, 1);
        assert.equal(reconnects, 0);
      }
    } finally {
      client.dispose?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
      await rm(paths.directory, { recursive: true, force: true });
    }
  }
});

test("OS singleton ownership releases after its process crashes", async () => {
  const { spawn } = await import("node:child_process");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { connectionPaths } = await import("../packages/client/src/paths.js");
  const root = await mkdtemp(join(tmpdir(), "wm-crash-"));
  const paths = connectionPaths(root);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const code = `import Database from 'better-sqlite3';const db=new Database(${JSON.stringify(join(paths.directory, "singleton.sqlite"))});db.exec('BEGIN EXCLUSIVE');process.stdout.write('locked\\n');setInterval(()=>{},1000);`;
  const owner = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    owner.stdout.once("data", () => resolve());
    owner.once("error", reject);
    owner.once("exit", (code) =>
      reject(Error("Owner exited before acquiring lock: " + code)),
    );
  });
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await assert.rejects(async () => {
      server = await startServer({
        stateRoot: root,
        dispatch: async () => ({ protocolVersion: 1 }),
      });
    }, /already running|starting/i);
    const exited = new Promise((resolve) => owner.once("exit", resolve));
    owner.kill("SIGKILL");
    await exited;
    await writeFile(
      paths.lock,
      JSON.stringify({ pid: owner.pid, startIdentity: "crashed" }),
      { mode: 0o600 },
    );
    server = await startServer({
      stateRoot: root,
      dispatch: async () => ({ protocolVersion: 1 }),
    });
    assert.equal(
      (await new ControllerClient(root).call("controller.status"))
        .protocolVersion,
      1,
    );
  } finally {
    owner.kill("SIGKILL");
    await server?.close();
    await rm(root, { recursive: true, force: true });
    await rm(paths.directory, { recursive: true, force: true });
  }
});

test("concurrent connectOrStart clients launch one controller and preserve connection options", async () => {
  const { readFile } = await import("node:fs/promises");
  const { pathToFileURL } = await import("node:url");
  const { connectOrStart } = await import("../packages/client/src/connect.js");
  const { connectionPaths } = await import("../packages/client/src/paths.js");
  const root = await mkdtemp(join(tmpdir(), "wm-shared-start-"));
  const marker = join(root, "launches");
  const serverModule = pathToFileURL(
    join(process.cwd(), "packages/controller/src/server.ts"),
  ).href;
  const code = `import {appendFile} from 'node:fs/promises';import {startServer} from ${JSON.stringify(serverModule)};await appendFile(${JSON.stringify(marker)},'launch\\n');const server=await startServer({stateRoot:process.env.WORKTREE_MANAGER_HOME,dispatch:async()=>({protocolVersion:1,pid:process.pid})});process.on('SIGTERM',()=>void server.close().then(()=>process.exit(0)));`;
  let clients: Awaited<ReturnType<typeof connectOrStart>>[] = [];
  let pid: number | undefined;
  try {
    clients = await Promise.all(
      Array.from({ length: 8 }, () =>
        connectOrStart({
          stateRoot: root,
          executable: process.execPath,
          args: ["--import", "tsx", "--input-type=module", "-e", code],
          keepAliveMs: 10,
        }),
      ),
    );
    const records = await Promise.all(
      clients.map((client) => client.call("controller.status")),
    );
    pid = records[0].pid;
    assert.equal(new Set(records.map((record) => record.pid)).size, 1);
    assert.equal(await readFile(marker, "utf8"), "launch\n");
  } finally {
    clients.forEach((client) => client.dispose());
    if (pid) {
      process.kill(pid, "SIGTERM");
      const { processIdentity } =
        await import("../packages/controller/src/server.js");
      for (let attempt = 0; attempt < 100 && processIdentity(pid); attempt++)
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await rm(root, { recursive: true, force: true });
    await rm(connectionPaths(root).directory, { recursive: true, force: true });
  }
});
