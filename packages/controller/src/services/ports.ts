import net from "node:net";
import { DomainError } from "../../../contracts/src/errors.js";
export interface PortSpec {
  preferred: number;
  min: number;
  max: number;
}
export interface PortLease {
  port: number;
  release(): Promise<void>;
}
export async function allocatePorts(
  specs: Array<{ id: string; port: PortSpec }>,
  excluded = new Set<number>(),
): Promise<Map<string, PortLease>> {
  const leases = new Map<string, PortLease>();
  try {
    for (const item of specs) {
      const candidates = [
        item.port.preferred,
        ...Array.from(
          { length: Math.max(0, item.port.max - item.port.min + 1) },
          (_, i) => i + item.port.min,
        ),
      ].filter((p, i, a) => a.indexOf(p) === i);
      let lease: PortLease | undefined;
      for (const port of candidates) {
        if (port < 1 || port > 65535 || excluded.has(port)) continue;
        const server = net.createServer();
        const free = await new Promise<boolean>((resolve) => {
          server.once("error", () => resolve(false));
          server.listen({ port, host: "127.0.0.1", exclusive: true }, () =>
            resolve(true),
          );
        });
        if (!free) continue;
        lease = {
          port,
          release: () => new Promise((r) => server.close(() => r())),
        };
        excluded.add(port);
        break;
      }
      if (!lease)
        throw new DomainError("PORT_CONFLICT", `No free port for ${item.id}`, {
          range: item.port,
        });
      leases.set(item.id, lease);
    }
    return leases;
  } catch (e) {
    await Promise.all([...leases.values()].map((l) => l.release()));
    throw e;
  }
}
