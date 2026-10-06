import { createHmac, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, lstat, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "../../../contracts/src/errors.js";
const exec = promisify(execFile);
export async function repositoryInputs(root: string, declared: string[] = []) {
  let files: string[] = [];
  let source = "";
  try {
    source = (
      await exec("git", ["-C", root, "rev-parse", "HEAD"], { timeout: 3000 })
    ).stdout.trim();
    files = (
      await exec("git", ["-C", root, "ls-files", "-z"], {
        timeout: 3000,
        maxBuffer: 2 * 1024 * 1024,
      })
    ).stdout
      .split("\0")
      .filter(Boolean);
  } catch {
    files = (await readdir(root)).filter((f) =>
      /^(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements.*\.txt|pyproject\.toml|Cargo\.(toml|lock)|go\.(mod|sum)|input\.txt)$/.test(
        f,
      ),
    );
  }
  const canonical = await realpath(root);
  for (const file of declared) {
    if (path.isAbsolute(file) || file.split(/[\\/]/).includes(".."))
      throw new DomainError(
        "INVALID_INPUT",
        "Setup inputs must be relative and contained",
      );
    files.push(file);
  }
  const inputs: Array<[string, string]> = [];
  for (const file of [...new Set(files)].sort()) {
    try {
      const absolute = path.join(canonical, file);
      const parent = await realpath(path.dirname(absolute));
      if (path.relative(canonical, parent).startsWith(".."))
        throw new DomainError(
          "INVALID_INPUT",
          "Setup input parent escapes checkout",
        );
      const stat = await lstat(absolute);
      inputs.push([
        file,
        stat.isSymbolicLink()
          ? "symlink:" + (await readlink(absolute))
          : createHash("sha256")
              .update(await readFile(absolute))
              .digest("hex"),
      ]);
    } catch (e: any) {
      if (e instanceof DomainError) throw e;
      inputs.push([file, "missing"]);
    }
  }
  return { source, inputs };
}
export function inputFingerprint(salt: Buffer, value: unknown) {
  return createHmac("sha256", salt).update(JSON.stringify(value)).digest("hex");
}
