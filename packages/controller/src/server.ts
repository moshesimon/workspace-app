import { createServer, type Socket } from "node:net";
import { mkdir, chmod, lstat, readFile, unlink, open } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { connectionPaths, PROTOCOL_VERSION } from "../../client/src/paths.js";
import { commands } from "../../contracts/src/commands.js";
import { DomainError, errorRecord } from "../../contracts/src/errors.js";

export function processIdentity(pid: number) {
  try {
    return (
      execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim() || null
    );
  } catch {
    return null;
  }
}

function assertOwned(stat: Awaited<ReturnType<typeof lstat>>, label: string) {
  if (
    stat.isSymbolicLink() ||
    (process.getuid && stat.uid !== process.getuid())
  ) {
    throw new DomainError(
      "OWNERSHIP_UNVERIFIED",
      `${label} ownership or symlink is unsafe`,
    );
  }
}

// The transaction owns the OS lock, unlike a pid file. A crash releases it
// automatically, and no contender may inspect or unlink endpoints without it.
async function acquireSingleton(directory: string) {
  const filename = join(directory, "singleton.sqlite");
  let file;
  try {
    file = await open(
      filename,
      constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error: any) {
    if (error.code === "ELOOP")
      throw new DomainError(
        "OWNERSHIP_UNVERIFIED",
        "Singleton database symlink is unsafe",
      );
    throw error;
  }
  try {
    const opened = await file.stat();
    const current = await lstat(filename);
    assertOwned(current, "Singleton database");
    if (
      !opened.isFile() ||
      opened.dev !== current.dev ||
      opened.ino !== current.ino ||
      (process.getuid && opened.uid !== process.getuid())
    ) {
      throw new DomainError(
        "OWNERSHIP_UNVERIFIED",
        "Singleton database is not an owned regular file",
      );
    }
    await file.chmod(0o600);
  } finally {
    await file.close();
  }
  let database: Database.Database | undefined;
  try {
    database = new Database(filename, { timeout: 0 });
    database.exec("PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE");
    return database;
  } catch (error: any) {
    database?.close();
    if (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED")
      throw new DomainError(
        "CONTROLLER_BUSY",
        "Controller already running or starting",
      );
    throw error;
  }
}

async function ownedEndpoint(filename: string) {
  try {
    const stat = await lstat(filename);
    assertOwned(stat, "Controller endpoint");
    return stat;
  } catch (error: any) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function startServer(options: {
  stateRoot: string;
  dispatch: (name: string, input: any) => Promise<unknown>;
  idle?: () => boolean;
  idleMs?: number;
}) {
  const paths = connectionPaths(options.stateRoot);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const ds = await lstat(paths.directory);
  assertOwned(ds, "IPC directory");
  if (!ds.isDirectory())
    throw new DomainError(
      "OWNERSHIP_UNVERIFIED",
      "IPC path is not a directory",
    );
  await chmod(paths.directory, 0o700);
  const singleton = await acquireSingleton(paths.directory);
  let ownsEndpoints = false;
  let server: ReturnType<typeof createServer> | undefined;
  let idleTimer: ReturnType<typeof setInterval> | undefined;
  const sockets = new Set<Socket>();
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      if (idleTimer) clearInterval(idleTimer);
      for (const socket of sockets) socket.destroy();
      try {
        if (server?.listening)
          await new Promise<void>((resolve) => server!.close(() => resolve()));
        if (ownsEndpoints) {
          await unlink(paths.socket).catch(() => {});
          await unlink(paths.lock).catch(() => {});
        }
      } finally {
        singleton.close();
      }
    })();
    return closing;
  };
  try {
    const previous = await ownedEndpoint(paths.lock);
    if (previous) {
      if (!previous.isFile())
        throw new DomainError(
          "OWNERSHIP_UNVERIFIED",
          "Controller lock is not a regular file",
        );
      let owner;
      try {
        owner = JSON.parse(await readFile(paths.lock, "utf8"));
      } catch {
        throw new DomainError(
          "CONTROLLER_BUSY",
          "Controller lock is invalid; cannot establish previous ownership",
        );
      }
      if (
        Number.isSafeInteger(owner.pid) &&
        owner.pid > 0 &&
        processIdentity(owner.pid)
      )
        throw new DomainError("CONTROLLER_BUSY", "Controller already running");
      await unlink(paths.lock);
    }
    const staleSocket = await ownedEndpoint(paths.socket);
    if (staleSocket) {
      if (!staleSocket.isSocket())
        throw new DomainError(
          "OWNERSHIP_UNVERIFIED",
          "Controller socket is not a socket",
        );
      await unlink(paths.socket);
    }
    const lock = await open(paths.lock, "wx", 0o600);
    ownsEndpoints = true;
    try {
      await lock.writeFile(
        JSON.stringify({
          pid: process.pid,
          startIdentity: processIdentity(process.pid),
        }),
      );
    } finally {
      await lock.close();
    }
    let lastActivity = Date.now();
    server = createServer((socket) => {
      sockets.add(socket);
      let buffer = "";
      socket.setTimeout(35000, () => socket.destroy());
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      socket.on("data", async (chunk) => {
        buffer += chunk;
        if (buffer.length > 1024 * 1024) {
          socket.destroy();
          return;
        }
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        socket.pause();
        lastActivity = Date.now();
        try {
          const request = JSON.parse(buffer.slice(0, newline));
          if (request.protocolVersion !== PROTOCOL_VERSION)
            throw new DomainError(
              "PROTOCOL_MISMATCH",
              "Unsupported controller protocol version",
            );
          if (!(request.name in commands))
            throw new DomainError(
              "INVALID_INPUT",
              "Unknown controller command",
            );
          const result = await options.dispatch(request.name, request.input);
          socket.end(JSON.stringify({ id: request.id, result }) + "\n");
        } catch (error) {
          socket.end(JSON.stringify({ error: errorRecord(error) }) + "\n");
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server!.once("error", onError);
      server!.listen(paths.socket, () => {
        server!.removeListener("error", onError);
        resolve();
      });
    });
    await chmod(paths.socket, 0o600);
    const idleMs = options.idleMs ?? 60000;
    idleTimer = setInterval(
      () => {
        if (
          options.idle?.() &&
          sockets.size === 0 &&
          Date.now() - lastActivity > idleMs
        )
          void close();
      },
      Math.max(5, Math.min(5000, idleMs / 4)),
    );
    idleTimer.unref();
    return { socketPath: paths.socket, close, server };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function startController(
  stateRoot: string,
  options: {
    executable?: string;
    skillRoot?: string;
    codexHome?: string;
    agentsHome?: string;
  } = {},
) {
  const { Controller } = await import("./controller.js");
  let controller: any;
  const server = await startServer({
    stateRoot,
    dispatch: (name, input) => controller.call(name, input),
    idle: () => controller?.isIdle ?? false,
  });
  try {
    controller = new Controller(stateRoot, options);
  } catch (error) {
    await server.close();
    throw error;
  }
  server.server.on("close", () => controller.close());
  return { ...server, controller };
}
