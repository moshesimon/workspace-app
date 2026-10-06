import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
const exec = promisify(execFile);
export async function processIdentity(pid: number): Promise<string | null> {
  try {
    const { stdout } = await exec(
      "ps",
      ["-p", String(pid), "-o", "lstart=", "-o", "pgid=", "-o", "stat="],
      { timeout: 2000, maxBuffer: 65536 },
    );
    if (!stdout.trim() || /\bZ/.test(stdout)) return null;
    let identity = stdout
      .trim()
      .replace(/\s+/g, " ")
      .split(" ")
      .slice(0, -1)
      .join(" ");
    if (process.platform === "linux") {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      identity += ":" + stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    }
    return identity;
  } catch {
    return null;
  }
}
export async function listenerPorts(pid: number): Promise<number[]> {
  const { stdout } = await exec(
    "lsof",
    ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"],
    { timeout: 2000, maxBuffer: 65536 },
  ).catch((e: any) => {
    if (e.code === 1) return { stdout: "" };
    throw e;
  });
  return [
    ...new Set(
      stdout
        .split("\n")
        .filter((l) => l.startsWith("n"))
        .map((l) => Number(l.match(/:(\d+)(?:\s|$)/)?.[1]))
        .filter(Boolean),
    ),
  ];
}
export interface ProcessGroupMember {
  pid: number;
  identity: string;
  parentPid: number;
}
export async function processGroupMembers(
  group: number,
): Promise<ProcessGroupMember[]> {
  const { stdout } = await exec("ps", ["-axo", "pid=,pgid=,ppid="], {
    timeout: 2000,
    maxBuffer: 1024 * 1024,
  });
  const entries = stdout
    .trim()
    .split("\n")
    .map((row) => row.trim().split(/\s+/).map(Number))
    .filter(([, pgid]) => pgid === group);
  const members = await Promise.all(
    entries.map(async ([pid, , parentPid]) => ({
      pid,
      parentPid,
      identity: await processIdentity(pid),
    })),
  );
  return members.filter(
    (member): member is ProcessGroupMember => member.identity !== null,
  );
}
export interface OwnedListeners {
  state: "running" | "stopped" | "unknown";
  observedPorts: number[];
  observedProcesses: Array<{
    pid: number;
    startIdentity: string;
    observedPorts: number[];
  }>;
}
export async function inspectOwnedListeners(
  pid: number,
  group: number,
  startIdentity: string,
): Promise<OwnedListeners> {
  const unavailable = (state: "stopped" | "unknown"): OwnedListeners => ({
    state,
    observedPorts: [],
    observedProcesses: [],
  });
  if (!pid || group !== pid || !startIdentity) return unavailable("unknown");
  const beforeRoot = await processIdentity(pid);
  if (!beforeRoot)
    return unavailable(
      (await processGroupMembers(group)).length ? "unknown" : "stopped",
    );
  if (beforeRoot !== startIdentity) return unavailable("unknown");
  const before = await processGroupMembers(group);
  const beforeByPid = new Map(before.map((member) => [member.pid, member]));
  if (beforeByPid.get(pid)?.identity !== startIdentity)
    return unavailable("unknown");
  const isDescendant = (
    member: ProcessGroupMember,
    members: Map<number, ProcessGroupMember>,
  ) => {
    const seen = new Set<number>();
    let current: ProcessGroupMember | undefined = member;
    while (current && !seen.has(current.pid)) {
      if (current.pid === pid) return true;
      seen.add(current.pid);
      current = members.get(current.parentPid);
    }
    return false;
  };
  const candidates = before.filter((member) =>
    isDescendant(member, beforeByPid),
  );
  const inspected = await Promise.all(
    candidates.map(async (member) => {
      if ((await processIdentity(member.pid)) !== member.identity) return null;
      const ports = await listenerPorts(member.pid);
      if ((await processIdentity(member.pid)) !== member.identity) return null;
      return { member, ports };
    }),
  );
  const after = await processGroupMembers(group);
  const afterByPid = new Map(after.map((member) => [member.pid, member]));
  if (
    (await processIdentity(pid)) !== startIdentity ||
    afterByPid.get(pid)?.identity !== startIdentity
  )
    return unavailable("unknown");
  const observedProcesses = inspected.flatMap((observed) => {
    if (!observed) return [];
    const current = afterByPid.get(observed.member.pid);
    if (
      !current ||
      current.identity !== observed.member.identity ||
      !isDescendant(current, afterByPid)
    )
      return [];
    return [
      {
        pid: current.pid,
        startIdentity: current.identity,
        observedPorts: observed.ports,
      },
    ];
  });
  return {
    state: "running",
    observedPorts: [
      ...new Set(observedProcesses.flatMap((process) => process.observedPorts)),
    ].sort((a, b) => a - b),
    observedProcesses,
  };
}
