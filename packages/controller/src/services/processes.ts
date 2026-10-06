import { spawn } from "node:child_process";
import net from "node:net";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DomainError } from "../../../contracts/src/errors.js";
import {
  processIdentity,
  processGroupMembers,
  inspectOwnedListeners,
} from "./platform/macos.js";
import type { OwnedListeners } from "./platform/macos.js";
const MAX_LOG = 1024 * 1024;
const buffers = new Map<string, string>();
const redactions = new Map<string, Set<string>>();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function recordLog(
  logPath: string,
  chunk: string,
  secrets: Set<string>,
) {
  let previous = buffers.get(logPath);
  let base = 0;
  try {
    base = Number(readFileSync(logPath + ".offset", "utf8")) || 0;
  } catch {}
  if (previous === undefined) {
    try {
      previous = readFileSync(logPath, "utf8");
    } catch {
      previous = "";
    }
  }
  const combined = previous + chunk;
  const dropped = Math.max(0, combined.length - MAX_LOG);
  const raw = combined.slice(-MAX_LOG);
  buffers.delete(logPath);
  buffers.set(logPath, raw);
  const known = redactions.get(logPath) ?? new Set<string>();
  for (const secret of secrets) known.add(secret);
  redactions.set(logPath, known);
  let safe = raw;
  for (const secret of known)
    if (secret) safe = safe.split(secret).join("[REDACTED]");
  mkdirSync(path.dirname(logPath), { recursive: true });
  writeFileSync(logPath, safe);
  writeFileSync(logPath + ".offset", String(base + dropped));
  if (buffers.size > 64) {
    const oldest = buffers.keys().next().value!;
    buffers.delete(oldest);
    redactions.delete(oldest);
  }
}
export function readLogs(logPath: string, offset = 0, limit = 65536) {
  let all = "";
  let base = 0;
  try {
    all = readFileSync(logPath, "utf8");
    base = Number(readFileSync(logPath + ".offset", "utf8")) || 0;
  } catch {}
  const start = Math.max(base, offset, 0);
  const text = all.slice(
    start - base,
    start - base + Math.min(Math.max(0, limit), MAX_LOG),
  );
  return { text, nextOffset: start + text.length };
}

export async function runCommand(
  command: { executable: string; args: string[] },
  cwd: string,
  env: Record<string, string>,
  logPath: string,
  secrets: Set<string>,
  timeoutMs = 30000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    let done = false;
    let startIdentity: Promise<string | null> = Promise.resolve(null);
    child.once("spawn", () => {
      startIdentity = processIdentity(child.pid!);
    });
    const timer = setTimeout(async () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        const identity = await startIdentity;
        if (!identity)
          throw new DomainError(
            "OWNERSHIP_UNVERIFIED",
            "Timed-out command has no verified start identity",
          );
        await stopProcess({
          pid: child.pid,
          processGroup: child.pid,
          startIdentity: identity,
        });
        reject(
          new DomainError(
            "DEPENDENCY_UNAVAILABLE",
            `Command timed out: ${command.executable}`,
          ),
        );
      } catch (error) {
        reject(error);
      }
    }, timeoutMs);
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(output);
    };
    child.stdout.on("data", (data) => {
      output = (output + data.toString()).slice(-MAX_LOG);
      recordLog(logPath, data.toString(), secrets);
    });
    child.stderr.on("data", (data) =>
      recordLog(logPath, data.toString(), secrets),
    );
    child.once("error", (e) =>
      finish(
        new DomainError(
          "DEPENDENCY_UNAVAILABLE",
          `Cannot execute ${command.executable}: ${e.message}`,
        ),
      ),
    );
    child.once("close", (code) =>
      finish(
        code === 0
          ? undefined
          : new DomainError(
              "DEPENDENCY_UNAVAILABLE",
              `Command failed (${code}): ${command.executable}`,
            ),
      ),
    );
  });
}
export async function launch(
  command: {
    executable: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
  },
  logPath: string,
  secrets: Set<string>,
) {
  const child = spawn(command.executable, command.args, {
    cwd: command.cwd,
    env: { ...process.env, ...command.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let spawnError: Error | undefined;
  child.on("error", (e) => {
    spawnError = e;
  });
  child.stdout.on("data", (d) => recordLog(logPath, d.toString(), secrets));
  child.stderr.on("data", (d) => recordLog(logPath, d.toString(), secrets));
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  }).catch((e: any) => {
    throw new DomainError(
      "DEPENDENCY_UNAVAILABLE",
      `Cannot execute ${command.executable}: ${e.message}`,
    );
  });
  let identity: string | null = null;
  for (let i = 0; i < 20 && !identity; i++) {
    identity = await processIdentity(child.pid!);
    if (!identity) await delay(25);
  }
  if (!identity || spawnError)
    throw new DomainError(
      "DEPENDENCY_UNAVAILABLE",
      "Process exited during launch",
    );
  return { pid: child.pid!, processGroup: child.pid!, startIdentity: identity };
}
export async function inspectProcess(record: any): Promise<OwnedListeners> {
  if (!record.pid || !record.startIdentity)
    return { state: "unknown", observedPorts: [], observedProcesses: [] };
  return inspectOwnedListeners(
    record.pid,
    record.processGroup,
    record.startIdentity,
  );
}
export async function waitReady(
  record: any,
  readiness: any = { type: "process" },
  timeoutMs = 5000,
) {
  const deadline = Date.now() + (readiness.timeoutMs ?? timeoutMs);
  let evidence: any;
  while (Date.now() < deadline) {
    const observed = await inspectProcess(record);
    if (observed.state !== "running")
      throw new DomainError(
        "DEPENDENCY_UNAVAILABLE",
        `Process ${record.logicalId} exited or has unknown ownership`,
      );
    if (
      record.assignedPort &&
      !observed.observedPorts.includes(record.assignedPort)
    ) {
      await delay(50);
      continue;
    }
    try {
      if (readiness.type === "http") {
        const response = await fetch(
          new URL(readiness.path ?? "/", record.url),
          { signal: AbortSignal.timeout(500) },
        );
        if (!response.ok) throw new Error("unhealthy");
        evidence = { type: "http", status: response.status };
      } else if (readiness.type === "tcp") {
        await new Promise<void>((resolve, reject) => {
          const socket = net.connect(record.assignedPort, "127.0.0.1");
          socket.setTimeout(500);
          socket.once("connect", () => {
            socket.destroy();
            resolve();
          });
          socket.once("error", reject);
          socket.once("timeout", () => {
            socket.destroy();
            reject(new Error("timeout"));
          });
        });
        evidence = { type: "tcp" };
      } else evidence = { type: "process" };
      return {
        ...observed,
        state: "ready",
        readinessEvidence: { ...evidence, at: new Date().toISOString() },
      };
    } catch {
      await delay(50);
    }
  }
  throw new DomainError(
    "DEPENDENCY_UNAVAILABLE",
    `Readiness timeout for ${record.logicalId}`,
    { assignedPort: record.assignedPort },
  );
}
export async function stopProcess(record: any) {
  if (
    !record.pid ||
    !record.startIdentity ||
    record.processGroup !== record.pid
  )
    throw new DomainError(
      "OWNERSHIP_UNVERIFIED",
      "Process ownership evidence is incomplete",
    );
  const identity = await processIdentity(record.pid);
  const members = await processGroupMembers(record.processGroup);
  if (!identity) {
    if (members.length)
      throw new DomainError(
        "OWNERSHIP_UNVERIFIED",
        "Process leader exited while unverified group members remain",
      );
    return;
  }
  if (identity !== record.startIdentity)
    throw new DomainError(
      "OWNERSHIP_UNVERIFIED",
      `Cannot signal process ${record.pid}`,
    );
  const known = new Map(members.map((m) => [m.pid, m.identity]));
  process.kill(-record.processGroup, "SIGTERM");
  for (let i = 0; i < 40; i++) {
    if (!(await processGroupMembers(record.processGroup)).length) return;
    await delay(50);
  }
  const survivors = await processGroupMembers(record.processGroup);
  if (survivors.some((m) => known.get(m.pid) !== m.identity))
    throw new DomainError(
      "OWNERSHIP_UNVERIFIED",
      "Process group identity changed during Stop",
    );
  if (survivors.length) process.kill(-record.processGroup, "SIGKILL");
  for (let i = 0; i < 20; i++) {
    if (!(await processGroupMembers(record.processGroup)).length) return;
    await delay(25);
  }
  throw new DomainError(
    "DEPENDENCY_UNAVAILABLE",
    "Owned process group did not exit",
  );
}
export const startServices = launch;
export const stopServices = stopProcess;
export async function probeTcp(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 1000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}
