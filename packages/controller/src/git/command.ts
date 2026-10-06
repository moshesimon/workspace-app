import { execFile } from "node:child_process";
import { realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "../../../contracts/src/errors.js";
export function git(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    execFile(
      "git",
      ["-C", cwd, ...args],
      {
        encoding: "buffer",
        maxBuffer: 32 * 1024 * 1024,
        timeout: 30_000,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
        },
      },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new DomainError(
              "GIT_ERROR",
              stderr.toString().trim() || error.message,
              { args, cwd },
            ),
          );
        else resolve(stdout);
      },
    ),
  );
}
export async function gitText(cwd: string, args: string[]) {
  return (await git(cwd, args)).toString("utf8").replace(/\r?\n$/, "");
}
export async function canonicalExisting(input: string) {
  return realpath(path.resolve(input));
}
export async function canonicalNew(input: string) {
  const target = path.resolve(input);
  const parent = await canonicalExisting(path.dirname(target));
  const name = path.basename(target);
  if (!name || name === "." || name === ".." || name.includes("\0"))
    throw new DomainError("INVALID_PATH", "Invalid checkout directory");
  try {
    await lstat(path.join(parent, name));
    throw new DomainError("PATH_CONFLICT", "Checkout path already exists");
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  return path.join(parent, name);
}
export function contains(root: string, candidate: string) {
  const rel = path.relative(root, candidate);
  return (
    rel === "" ||
    (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))
  );
}
export async function safeFile(root: string, file: string) {
  const base = await canonicalExisting(root);
  if (!file || file.includes("\0") || path.isAbsolute(file))
    throw new DomainError("INVALID_PATH", "File must be a relative path");
  const candidate = path.resolve(base, file);
  if (!contains(base, candidate) || candidate === base)
    throw new DomainError("INVALID_PATH", "File is outside checkout");
  try {
    const actual = await realpath(candidate);
    if (!contains(base, actual))
      throw new DomainError("INVALID_PATH", "File resolves outside checkout");
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
    let parent = path.dirname(candidate);
    for (;;) {
      try {
        const actual = await realpath(parent);
        if (!contains(base, actual))
          throw new DomainError(
            "INVALID_PATH",
            "Parent resolves outside checkout",
          );
        break;
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
        parent = path.dirname(parent);
      }
    }
  }
  return { base, file: path.relative(base, candidate), absolute: candidate };
}
export function validRef(ref: string) {
  if (
    !ref ||
    ref.startsWith("-") ||
    ref.includes("\0") ||
    ref.includes("\n") ||
    ref.length > 1024
  )
    throw new DomainError("INVALID_REF", "Invalid Git ref");
}
export async function resolveCommit(root: string, ref: string) {
  validRef(ref);
  return gitText(root, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${ref}^{commit}`,
  ]);
}
