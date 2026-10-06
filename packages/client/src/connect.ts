import { createConnection, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { openSync, closeSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DomainError } from "../../contracts/src/errors.js";
import {
  connectionPaths,
  defaultStateRoot,
  PROTOCOL_VERSION,
} from "./paths.js";

class TransportError extends DomainError {
  constructor(
    code: string,
    message: string,
    public safeToRetry: boolean,
  ) {
    super(code, message);
  }
}
export interface ClientOptions {
  keepAliveMs?: number;
  reconnect?: () => Promise<void>;
  requestTimeoutMs?: number;
}
export class ControllerClient {
  private heartbeat?: ReturnType<typeof setInterval>;
  private heartbeatPending = false;
  private disposed = false;
  private reconnecting?: Promise<void>;
  private sockets = new Set<Socket>();
  constructor(
    public stateRoot = defaultStateRoot(),
    private options: ClientOptions = {},
  ) {
    if (options.keepAliveMs && options.keepAliveMs > 0) {
      this.heartbeat = setInterval(() => {
        if (this.heartbeatPending || this.disposed) return;
        this.heartbeatPending = true;
        void this.call("controller.status")
          .catch(() => {})
          .finally(() => {
            this.heartbeatPending = false;
          });
      }, options.keepAliveMs);
      this.heartbeat.unref();
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const socket of this.sockets) socket.destroy();
  }
  private recover() {
    if (!this.reconnecting) {
      this.reconnecting = Promise.resolve()
        .then(() => this.options.reconnect!())
        .finally(() => {
          this.reconnecting = undefined;
        });
    }
    return this.reconnecting;
  }
  async call(name: string, input: Record<string, unknown> = {}): Promise<any> {
    // Preserve the entire serialized operation, including its original key,
    // even if the caller changes its input while reconnection is in progress.
    const preserved = JSON.parse(JSON.stringify(input));
    try {
      return await this.request(name, preserved);
    } catch (error) {
      const hasKey =
        typeof preserved.idempotencyKey === "string" &&
        preserved.idempotencyKey.length > 0;
      if (
        this.disposed ||
        !this.options.reconnect ||
        !(error instanceof TransportError) ||
        (!error.safeToRetry && !hasKey)
      )
        throw error;
      await this.recover();
      return this.request(name, preserved); // At most one retry; domain failures never reach recovery.
    }
  }
  private request(name: string, input: Record<string, unknown>): Promise<any> {
    if (this.disposed)
      return Promise.reject(
        new DomainError("CLIENT_DISPOSED", "Controller client was disposed"),
      );
    return new Promise((resolve, reject) => {
      const socket = createConnection(connectionPaths(this.stateRoot).socket);
      this.sockets.add(socket);
      let buffer = "",
        sent = false,
        settled = false;
      const id = randomUUID();
      const finish = (error?: unknown, result?: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.sockets.delete(socket);
        socket.destroy();
        if (error) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(
        () =>
          finish(
            new TransportError(
              "CONTROLLER_TIMEOUT",
              "Controller request timed out. Retry the same operation key.",
              false,
            ),
          ),
        this.options.requestTimeoutMs ?? 30000,
      );
      socket.once("connect", () => {
        sent = true;
        socket.write(
          JSON.stringify({
            id,
            protocolVersion: PROTOCOL_VERSION,
            name,
            input,
          }) + "\n",
        );
      });
      socket.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.length > 8 * 1024 * 1024)
          return finish(
            new DomainError(
              "INVALID_RESPONSE",
              "Controller response exceeds limit",
            ),
          );
        const line = buffer.indexOf("\n");
        if (line < 0) return;
        try {
          const result = JSON.parse(buffer.slice(0, line));
          if (result.error)
            finish(
              new DomainError(
                result.error.code,
                result.error.message,
                result.error.details,
              ),
            );
          else if (result.id !== id)
            finish(
              new DomainError(
                "INVALID_RESPONSE",
                "Controller response identity does not match request",
              ),
            );
          else finish(undefined, result.result);
        } catch (error) {
          finish(error);
        }
      });
      socket.once("error", (error: NodeJS.ErrnoException) => {
        const code = error.code || "CONTROLLER_DISCONNECTED";
        if (["ENOENT", "ECONNREFUSED", "ECONNRESET", "EPIPE"].includes(code))
          finish(new TransportError(code, error.message, !sent));
        else finish(error);
      });
      socket.once("close", () => {
        if (this.disposed)
          finish(
            new DomainError(
              "CLIENT_DISPOSED",
              "Controller client was disposed",
            ),
          );
        else
          finish(
            new TransportError(
              "CONTROLLER_DISCONNECTED",
              "Controller connection closed before a response",
              !sent,
            ),
          );
      });
    });
  }
}

export interface ConnectOptions {
  stateRoot?: string;
  executable?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  keepAliveMs?: number;
}
const starting = new Map<string, Promise<void>>();
function ensureController(options: ConnectOptions, stateRoot: string) {
  const key = connectionPaths(stateRoot).socket;
  let attempt = starting.get(key);
  if (!attempt) {
    attempt = startOrProbe(options, stateRoot).finally(() => {
      starting.delete(key);
    });
    starting.set(key, attempt);
  }
  return attempt;
}
function safeUnavailable(error: unknown) {
  return error instanceof TransportError && error.safeToRetry;
}
async function startOrProbe(options: ConnectOptions, stateRoot: string) {
  const probe = new ControllerClient(stateRoot);
  const check = async () => {
    const status = await probe.call("controller.status");
    if (status?.protocolVersion !== PROTOCOL_VERSION)
      throw new DomainError(
        "PROTOCOL_MISMATCH",
        "Controller version differs; stop the previous installation first",
      );
  };
  try {
    try {
      await check();
      return;
    } catch (error) {
      if (!safeUnavailable(error)) throw error;
    }
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    const fd = openSync(join(stateRoot, "controller.log"), "a", 0o600);
    let child;
    try {
      child = spawn(
        options.executable ?? process.execPath,
        options.args ?? [...process.argv.slice(1, 2), "--mode=controller"],
        {
          detached: true,
          stdio: ["ignore", fd, fd],
          env: {
            ...process.env,
            ...options.env,
            WORKTREE_MANAGER_HOME: stateRoot,
          },
        },
      );
    } finally {
      closeSync(fd);
    }
    child.unref();
    let spawnError: Error | undefined;
    child.on("error", (error) => {
      spawnError = error;
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      await new Promise((resolve) => setTimeout(resolve, 75));
      try {
        await check();
        return;
      } catch (error) {
        if (!safeUnavailable(error)) throw error;
      }
    }
    throw new DomainError(
      "CONTROLLER_UNAVAILABLE",
      `Cannot connect to controller. Inspect ${join(stateRoot, "controller.log")}`,
    );
  } finally {
    probe.dispose();
  }
}
export async function connectOrStart(options: ConnectOptions = {}) {
  const stateRoot = options.stateRoot ?? defaultStateRoot();
  await ensureController(options, stateRoot);
  return new ControllerClient(stateRoot, {
    keepAliveMs: options.keepAliveMs ?? 20000,
    reconnect: () => ensureController(options, stateRoot),
  });
}
