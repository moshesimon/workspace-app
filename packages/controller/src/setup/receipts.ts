import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
const exec = promisify(execFile);
export async function repositoryInputs(root: string) {
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
  const inputs: Array<[string, string]> = [];
  for (const file of files.sort()) {
    try {
      inputs.push([
        file,
        (await readFile(path.join(root, file))).toString("base64"),
      ]);
    } catch {
      inputs.push([file, "missing"]);
    }
  }
  return { source, inputs };
}
export function inputFingerprint(salt: Buffer, value: unknown) {
  return createHmac("sha256", salt).update(JSON.stringify(value)).digest("hex");
}
