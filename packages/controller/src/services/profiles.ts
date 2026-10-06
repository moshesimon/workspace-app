import path from "node:path";
import { realpath, mkdir, lstat } from "node:fs/promises";
import { DomainError } from "../../../contracts/src/errors.js";
export interface ResolutionContext {
  workspaceId: string;
  checkoutPath: string;
  port?: number;
  url?: string;
  urls: Record<string, string>;
  secrets: Set<string>;
}
export function resolveTemplate(value: string, ctx: ResolutionContext): string {
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, token: string) => {
    if (token === "workspace.id") return ctx.workspaceId;
    if (token === "checkout.path") return ctx.checkoutPath;
    if (token === "self.port" && ctx.port) return String(ctx.port);
    if (token === "self.url" && ctx.url) return ctx.url;
    if (token.startsWith("secret.")) {
      const name = token.slice(7);
      const secret = process.env[name];
      if (!secret)
        throw new DomainError(
          "SETUP_INPUT_REQUIRED",
          `Missing local input ${name}`,
          { name },
        );
      ctx.secrets.add(secret);
      return secret;
    }
    if (ctx.urls[token]) return ctx.urls[token];
    throw new DomainError("INVALID_INPUT", `Unresolved template ${token}`);
  });
}
export async function containedPath(
  root: string,
  relative: string,
  create = false,
): Promise<string> {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
    throw new DomainError(
      "INVALID_INPUT",
      "Runtime path must be checkout relative",
    );
  const base = await realpath(root);
  const target = path.resolve(root, relative);
  let current = base;
  for (const part of path
    .relative(root, target)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        const actual = await realpath(current);
        if (actual !== base && !actual.startsWith(base + path.sep))
          throw new DomainError(
            "INVALID_INPUT",
            "Runtime path escapes checkout through a symlink",
          );
        current = actual;
      }
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      if (create) await mkdir(current);
      else
        throw new DomainError(
          "INVALID_INPUT",
          `Working directory is missing: ${relative}`,
        );
    }
  }
  return current;
}
export async function resolveProfile(profile: any, ctx: ResolutionContext) {
  const cwd = await containedPath(ctx.checkoutPath, profile.cwd ?? ".");
  const env = Object.fromEntries(
    Object.entries(profile.env ?? {}).map(([key, value]) => [
      key,
      resolveTemplate(String(value), ctx),
    ]),
  );
  return {
    executable: resolveTemplate(profile.executable, ctx),
    args: (profile.args ?? []).map((arg: string) => resolveTemplate(arg, ctx)),
    cwd,
    env,
  };
}
