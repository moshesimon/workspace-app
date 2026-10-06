import { readFile, lstat } from "node:fs/promises";
import { DomainError } from "../../../contracts/src/errors.js";
import { git, safeFile } from "./command.js";
export interface ChangedFile {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}
export async function readChanges(root: string) {
  const tokens = (
    await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
  )
    .toString("utf8")
    .split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const record = tokens[i]!;
    if (!record) continue;
    const indexStatus = record[0]!,
      worktreeStatus = record[1]!,
      untracked = indexStatus === "?" && worktreeStatus === "?";
    const file: ChangedFile = {
      path: record.slice(3),
      indexStatus,
      worktreeStatus,
      staged: !untracked && indexStatus !== " ",
      unstaged: !untracked && worktreeStatus !== " ",
      untracked,
    };
    if (
      indexStatus === "R" ||
      indexStatus === "C" ||
      worktreeStatus === "R" ||
      worktreeStatus === "C"
    )
      file.originalPath = tokens[++i];
    files.push(file);
  }
  const staged = files.filter((f) => f.staged).length,
    unstaged = files.filter((f) => f.unstaged).length,
    untracked = files.filter((f) => f.untracked).length;
  return { files, staged, unstaged, untracked, clean: files.length === 0 };
}
const MAX_DIFF = 1024 * 1024;
export function displayDiff(buffer: Buffer) {
  return {
    text: buffer.subarray(0, MAX_DIFF).toString("utf8"),
    binary:
      buffer.includes(0) ||
      /^Binary files .* differ$/m.test(buffer.toString("utf8")),
    truncated: buffer.length > MAX_DIFF,
  };
}
export async function readDiff(
  root: string,
  file: string,
  area: "staged" | "unstaged" | "untracked",
) {
  const safe = await safeFile(root, file);
  if (!["staged", "unstaged", "untracked"].includes(area))
    throw new DomainError("INVALID_INPUT", "Unknown diff area");
  if (area === "untracked") {
    const found = (await readChanges(safe.base)).files.find(
      (f) => f.path === safe.file && f.untracked,
    );
    if (!found) throw new DomainError("NOT_UNTRACKED", "File is not untracked");
    const stat = await lstat(safe.absolute);
    if (stat.isSymbolicLink())
      return { text: `Symlink: ${safe.file}`, binary: false, truncated: false };
    if (!stat.isFile())
      throw new DomainError("INVALID_PATH", "Untracked diff requires a file");
    if (stat.size > MAX_DIFF)
      return {
        text: "File is too large to preview",
        binary: false,
        truncated: true,
      };
    const contents = await readFile(safe.absolute);
    if (contents.includes(0))
      return { text: "Binary file", binary: true, truncated: false };
    const text = contents.toString("utf8");
    return {
      text: text
        ? `--- /dev/null\n+++ ${JSON.stringify(safe.file)}\n@@ -0,0 +1,${text.split("\n").length - (text.endsWith("\n") ? 1 : 0)} @@\n${text
            .split("\n")
            .map((line) => "+" + line)
            .join("\n")}`
        : "Empty file",
      binary: false,
      truncated: false,
    };
  }
  const changed = (await readChanges(safe.base)).files.find(
    (item) => item.path === safe.file,
  );
  const paths = changed?.originalPath
    ? [safe.file, (await safeFile(safe.base, changed.originalPath)).file]
    : [safe.file];
  return displayDiff(
    await git(safe.base, [
      "-c",
      "core.quotePath=false",
      "diff",
      "--find-renames",
      "--no-ext-diff",
      "--no-textconv",
      ...(area === "staged" ? ["--cached"] : []),
      "--",
      ...paths,
    ]),
  );
}
