import { z } from "zod";
import { DomainError } from "./errors.js";
const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
const relative = z
  .string()
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !p.startsWith("~") &&
      !p.includes("\\") &&
      !p.split("/").includes(".."),
    "Paths must be relative and contained; cannot escape the project",
  );
const port = z
  .object({
    preferred: z.number().int().min(1024).max(65535),
    min: z.number().int().min(1024).max(65535),
    max: z.number().int().min(1024).max(65535),
  })
  .refine(
    (p) => p.min <= p.max && p.preferred >= p.min && p.preferred <= p.max,
    "Invalid port range",
  );
const command = z.object({
  executable: z.string().min(1),
  args: z.array(z.string()).default([]),
});
const execution = {
  id: key,
  repository: key,
  args: z.array(z.string()).default([]),
  cwd: relative.default("."),
  env: z.record(z.string(), z.string()).default({}),
  dependsOn: z.array(z.string()).default([]),
};
export const serviceSchema = z.object({
  ...execution,
  executable: z.string().min(1),
  runtimePaths: z.array(relative).default([]),
  port: port.optional(),
  readiness: z
    .object({
      type: z.enum(["http", "tcp", "process"]),
      path: z.string().optional(),
      timeoutMs: z.number().int().min(100).max(120000).optional(),
    })
    .optional(),
  url: z.string().optional(),
});
export const setupSchema = z.object({
  inputs: z.array(relative).default([]),
  ...execution,
  executable: z.string().min(1),
  runPolicy: z.enum(["oncePerInputs", "always"]).default("oncePerInputs"),
  probe: command.optional(),
});
export const resourceSchema = z.object({
  ...execution,
  adapter: z.enum(["process", "command", "external"]),
  executable: z.string().optional(),
  port: port.optional(),
  hooks: z
    .object({
      start: command,
      status: command,
      stop: command,
      destroy: command,
    })
    .optional(),
  disposablePaths: z.array(relative).default([]),
  url: z.string().optional(),
});
export const configurationSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(120),
  repositories: z
    .array(z.object({ key, path: relative, sourceRef: z.string().optional() }))
    .min(1),
  prerequisites: z
    .array(
      z.object({
        id: key,
        executable: z.string(),
        args: z.array(z.string()).default(["--version"]),
      }),
    )
    .default([]),
  setup: z.array(setupSchema).default([]),
  services: z.array(serviceSchema).default([]),
  resources: z.array(resourceSchema).default([]),
  bindings: z.record(z.string(), z.string()).default({}),
  entrypoints: z
    .array(z.object({ label: z.string(), service: z.string() }))
    .default([]),
});
export type ProjectConfiguration = z.infer<typeof configurationSchema>;
export type SetupRecipe = z.infer<typeof setupSchema>;
export type ServiceProfile = z.infer<typeof serviceSchema>;
export function validateConfiguration(
  input: unknown,
  _root?: string,
): ProjectConfiguration {
  if ((input as any)?.schemaVersion !== 1)
    throw new DomainError(
      "UNSUPPORTED_SCHEMA_VERSION",
      "Unsupported configuration schema version. Expected version 1.",
    );
  const parsed = configurationSchema.safeParse(input);
  if (!parsed.success)
    throw new DomainError(
      "INVALID_INPUT",
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  const m = parsed.data;
  const repos = new Set(m.repositories.map((r) => r.key));
  if (repos.size !== m.repositories.length)
    throw new DomainError("INVALID_INPUT", "Duplicate repository key");
  const nodes = new Map<string, string[]>();
  const services = new Set(m.services.map((s) => `${s.repository}/${s.id}`));
  const resources = new Set(m.resources.map((r) => r.id));
  for (const [prefix, items] of [
    ["setup", m.setup],
    ["resource", m.resources],
    ["service", m.services],
  ] as const) {
    for (const item of items) {
      if (!repos.has(item.repository))
        throw new DomainError(
          "INVALID_INPUT",
          `Unknown repository ${item.repository}`,
        );
      const name = `${prefix}:${prefix === "service" ? item.repository + "/" : ""}${item.id}`;
      if (nodes.has(name))
        throw new DomainError("INVALID_INPUT", `Duplicate ${name}`);
      nodes.set(name, item.dependsOn);
      for (const [name, value] of Object.entries(item.env)) {
        if (
          /(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)/i.test(name) &&
          value &&
          !/^\{\{secret\.[A-Za-z_][A-Za-z0-9_]*\}\}$/.test(value)
        )
          throw new DomainError(
            "INVALID_INPUT",
            `Use a secret reference for ${name}; portable manifests cannot contain real secrets`,
          );
      }
      const values = [
        ...item.args,
        ...Object.values(item.env),
        ("url" in item ? item.url : "") ?? "",
      ];
      for (const value of values)
        for (const token of value.matchAll(/\{\{([^{}]+)\}\}/g)) {
          const ref = token[1];
          if (
            ["workspace.id", "checkout.path", "self.port", "self.url"].includes(
              ref,
            ) ||
            /^secret\.[A-Za-z_][A-Za-z0-9_]*$/.test(ref)
          )
            continue;
          if (ref.startsWith("service.") && ref.endsWith(".url")) {
            const target = ref.slice(8, -4);
            const resolved =
              m.bindings[`${item.repository}/${target}`] ??
              m.bindings[target] ??
              (target.includes("/") ? target : `${item.repository}/${target}`);
            if (services.has(resolved)) continue;
          }
          if (
            ref.startsWith("resource.") &&
            ref.endsWith(".url") &&
            resources.has(ref.slice(9, -4))
          )
            continue;
          throw new DomainError(
            "INVALID_INPUT",
            `Unknown template reference ${ref}`,
          );
        }
    }
  }
  for (const r of m.resources) {
    if (r.adapter === "command" && !r.hooks)
      throw new DomainError(
        "INVALID_INPUT",
        `Resource ${r.id} needs lifecycle hooks`,
      );
    if (r.adapter === "process" && !r.executable)
      throw new DomainError(
        "INVALID_INPUT",
        `Resource ${r.id} needs an executable`,
      );
    if (r.adapter === "external" && !r.url)
      throw new DomainError(
        "INVALID_INPUT",
        `External resource ${r.id} needs a URL`,
      );
  }
  for (const [name, deps] of nodes)
    for (const dep of deps)
      if (!nodes.has(dep))
        throw new DomainError(
          "INVALID_INPUT",
          `Unknown dependency ${dep} in ${name}`,
        );
  const visiting = new Set<string>(),
    done = new Set<string>();
  function visit(name: string) {
    if (visiting.has(name))
      throw new DomainError(
        "INVALID_INPUT",
        `Execution dependency cycle at ${name}`,
      );
    if (done.has(name)) return;
    visiting.add(name);
    for (const dep of nodes.get(name) ?? []) visit(dep);
    visiting.delete(name);
    done.add(name);
  }
  for (const name of nodes.keys()) visit(name);
  for (const entry of m.entrypoints)
    if (!services.has(entry.service))
      throw new DomainError(
        "INVALID_INPUT",
        `Unknown entrypoint service ${entry.service}`,
      );
  for (const target of Object.values(m.bindings))
    if (!services.has(target))
      throw new DomainError(
        "INVALID_INPUT",
        `Unknown binding service ${target}`,
      );
  return m;
}
