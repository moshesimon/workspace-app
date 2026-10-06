import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { repositoryInputs } from "../packages/controller/src/setup/receipts.js";
test("declared untracked preparation inputs invalidate receipts without following external symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "wm-inputs-"));
  try {
    await writeFile(join(root, "README"), "tracked");
    execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" });
    execFileSync("git", ["-C", root, "add", "."]);
    execFileSync(
      "git",
      [
        "-C",
        root,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=t@local",
        "commit",
        "-m",
        "initial",
      ],
      { stdio: "ignore" },
    );
    await writeFile(join(root, "local-input.txt"), "first");
    const before = await repositoryInputs(root, ["local-input.txt"]);
    await writeFile(join(root, "local-input.txt"), "second");
    assert.notDeepEqual(
      await repositoryInputs(root, ["local-input.txt"]),
      before,
    );
    await assert.rejects(
      repositoryInputs(root, ["../outside"]),
      /contained|escape|relative/,
    );
    await symlink("/etc/passwd", join(root, "external-link"));
    const data = await repositoryInputs(root, ["external-link"]);
    assert.ok(JSON.stringify(data).includes("symlink:/etc/passwd"));
    assert.ok(!JSON.stringify(data).includes("root:"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
