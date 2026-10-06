import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  registerRepository,
  discoverWorktrees,
  createCheckout,
  adoptCheckout,
} from "../packages/controller/src/git/worktrees.js";
import {
  readChanges,
  readDiff,
} from "../packages/controller/src/git/changes.js";
import {
  readHistory,
  readCommit,
} from "../packages/controller/src/git/history.js";
import {
  inspectDestroy,
  removeCheckout,
} from "../packages/controller/src/git/destroy.js";
import { discoverProjectFolder } from "../packages/controller/src/projects/discovery.js";
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
async function fixture(t: any) {
  const root = await mkdtemp(path.join(os.tmpdir(), "manager Git ü "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const main = path.join(root, "main repo");
  await mkdir(main);
  git(main, "init", "-b", "main");
  git(main, "config", "user.name", "Fixture");
  git(main, "config", "user.email", "fixture@example.invalid");
  await writeFile(path.join(main, "hello.txt"), "base\n");
  await writeFile(path.join(main, ".gitignore"), "ignored/\n");
  git(main, "add", ".");
  git(main, "commit", "-m", "base");
  const info = await registerRepository(main);
  const repository = {
    ...info,
    id: "repo-id",
    projectId: "project-id",
    key: "app",
  };
  return { root, main, repository };
}
test("creation fixes provenance while source advances and existing branches have unknown origins", async (t) => {
  const { root, main, repository } = await fixture(t);
  const base = git(main, "rev-parse", "HEAD");
  const checkout = await createCheckout({
    repository,
    workspaceId: "workspace",
    path: path.join(root, "new ü worktree"),
    branch: "feature/one",
    sourceRef: "main",
  });
  assert.equal(checkout.sourceCommit, base);
  assert.equal(checkout.createdBranch, "feature/one");
  await writeFile(path.join(main, "hello.txt"), "advanced\n");
  git(main, "commit", "-am", "advance");
  assert.equal(checkout.sourceCommit, base);
  const found = await discoverWorktrees(main);
  assert.equal(found.length, 2);
  assert.equal(found.find((w) => w.main)?.path, repository.mainPath);
  git(main, "branch", "existing");
  const existing = await createCheckout({
    repository,
    workspaceId: "workspace",
    path: path.join(root, "existing"),
    branch: "existing",
    sourceRef: "main",
    existingBranch: true,
  });
  assert.equal(existing.originEvidence, "unknown");
  assert.equal(existing.sourceCommit, null);
  await assert.rejects(
    createCheckout({
      repository,
      workspaceId: "w",
      path: path.join(root, "conflict"),
      branch: "existing",
      sourceRef: "main",
    }),
  );
  await assert.rejects(
    createCheckout({
      repository,
      workspaceId: "w",
      path: path.join(root, "unsafe"),
      branch: "bad..branch",
      sourceRef: "main",
    }),
  );
});
test("status preserves staged unstaged untracked rename and unusual filenames with safe diffs", async (t) => {
  const { root, repository } = await fixture(t);
  const c = await createCheckout({
    repository,
    workspaceId: "w",
    path: path.join(root, "changes"),
    branch: "changes",
    sourceRef: "main",
  });
  git(c.path, "mv", "hello.txt", "renamed ü.txt");
  await writeFile(path.join(c.path, "renamed ü.txt"), "changed\n");
  const weird = "space ü\nfile.txt";
  await writeFile(path.join(c.path, weird), "new text\n");
  await writeFile(path.join(c.path, "binary.bin"), Buffer.from([0, 1, 2]));
  const status = await readChanges(c.path);
  assert.equal(status.staged, 1);
  assert.equal(status.unstaged, 1);
  assert.equal(status.untracked, 2);
  assert.equal(
    status.files.find((f) => f.path === "renamed ü.txt")?.originalPath,
    "hello.txt",
  );
  assert.ok(status.files.some((f) => f.path === weird));
  assert.match(
    (await readDiff(c.path, "renamed ü.txt", "staged")).text,
    /rename from hello.txt/,
  );
  assert.match(
    (await readDiff(c.path, "renamed ü.txt", "unstaged")).text,
    /changed/,
  );
  assert.match((await readDiff(c.path, weird, "untracked")).text, /new text/);
  assert.equal(
    (await readDiff(c.path, "binary.bin", "untracked")).binary,
    true,
  );
  await assert.rejects(readDiff(c.path, "../outside", "unstaged"));
  await symlink(path.join(root, "outside"), path.join(c.path, "escaping"));
  await writeFile(path.join(root, "outside"), "private");
  await assert.rejects(readDiff(c.path, "escaping", "untracked"));
});
test("history counts recorded base and exposes commit changes without modifying refs", async (t) => {
  const { root, repository } = await fixture(t);
  const c = await createCheckout({
    repository,
    workspaceId: "w",
    path: path.join(root, "history"),
    branch: "history",
    sourceRef: "main",
  });
  await writeFile(path.join(c.path, "hello.txt"), "one\n");
  git(c.path, "commit", "-am", "one");
  const result = await readHistory(c.path, c.sourceCommit, 1, 0);
  assert.equal(result.commitsSinceBase, 1);
  assert.equal(result.commits[0]?.subject, "one");
  assert.match((await readCommit(c.path, result.commits[0]!.hash)).text, /one/);
  assert.equal((await readHistory(c.path, null)).commitsSinceBase, null);
  await assert.rejects(readCommit(c.path, "--all"));
});
test("destroy fingerprints ignored file contents refuses dirty stale main discovered locked and detached targets and retains branches", async (t) => {
  const { root, main, repository } = await fixture(t);
  const c = await createCheckout({
    repository,
    workspaceId: "w",
    path: path.join(root, "destroy"),
    branch: "destroy",
    sourceRef: "main",
  });
  await mkdir(path.join(c.path, "ignored"));
  await writeFile(path.join(c.path, "ignored", "data"), "keep me");
  const first = await inspectDestroy(c, repository);
  assert.ok(first.files.some((f) => f.path === "ignored/data" && f.ignored));
  assert.equal(first.dirty, true);
  await assert.rejects(
    removeCheckout(c, repository, first.fingerprint, false),
    { code: "DIRTY_CHECKOUT" },
  );
  await writeFile(path.join(c.path, "ignored", "data"), "changed");
  await assert.rejects(removeCheckout(c, repository, first.fingerprint, true), {
    code: "STALE_PREVIEW",
  });
  const current = await inspectDestroy(c, repository);
  await removeCheckout(c, repository, current.fingerprint, true);
  assert.equal(
    git(main, "rev-parse", "--verify", "refs/heads/destroy"),
    c.sourceCommit,
  );
  await assert.rejects(
    adoptCheckout({ repository, workspaceId: "w", path: main }),
  );
  const discovered = { ...c, path: main, ownership: "discovered" as const };
  await assert.rejects(inspectDestroy(discovered, repository));
  const locked = await createCheckout({
    repository,
    workspaceId: "w",
    path: path.join(root, "locked"),
    branch: "locked",
    sourceRef: "main",
  });
  git(main, "worktree", "lock", locked.path);
  await assert.rejects(inspectDestroy(locked, repository));
  git(main, "worktree", "unlock", locked.path);
  git(locked.path, "checkout", "--detach");
  git(locked.path, "commit", "--allow-empty", "-m", "detached unique");
  await assert.rejects(inspectDestroy(locked, repository));
});
test("discovery inventories roots and linked paths skips dependencies symlinks and reports bounded traversal", async (t) => {
  const { root, main, repository } = await fixture(t);
  await createCheckout({
    repository,
    workspaceId: "w",
    path: path.join(root, "linked"),
    branch: "linked",
    sourceRef: "main",
  });
  await mkdir(path.join(root, "node_modules", "nested"), { recursive: true });
  git(path.join(root, "node_modules", "nested"), "init", "-b", "main");
  await symlink(main, path.join(root, "alias"));
  const report = await discoverProjectFolder(root);
  assert.equal(report.repositories.length, 1);
  assert.equal(report.repositories[0]?.worktrees.length, 2);
  assert.equal(report.truncated, false);
  const shallow = await discoverProjectFolder(root, { depth: 0 });
  assert.equal(shallow.truncated, true);
  assert.ok(shallow.evidence.length);
  const single = await discoverProjectFolder(main);
  assert.equal(single.repositories.length, 1);
});

test("adoption requires registered repository identity and clean removal preserves the branch", async (t) => {
  const { root, main, repository } = await fixture(t);
  const target = path.join(root, "adopt");
  git(main, "worktree", "add", "-b", "adopt", target);
  const adopted = await adoptCheckout({
    repository,
    workspaceId: "w",
    path: target,
  });
  assert.equal(adopted.ownership, "adopted");
  assert.equal(adopted.sourceCommit, null);
  const preview = await inspectDestroy(adopted, repository);
  assert.equal(preview.dirty, false);
  await removeCheckout(adopted, repository, preview.fingerprint, false);
  assert.ok(git(main, "rev-parse", "refs/heads/adopt"));
  await assert.rejects(
    adoptCheckout({ repository, workspaceId: "w", path: root }),
  );
  const created = await createCheckout({
    repository,
    workspaceId: "w",
    path: path.join(root, "replacement"),
    branch: "replace",
    sourceRef: "main",
  });
  await assert.rejects(
    inspectDestroy({ ...created, repositoryId: "wrong" }, repository),
    { code: "REPOSITORY_CHANGED" },
  );
  git(created.path, "checkout", "--detach");
  const detachedPreview = await inspectDestroy(created, repository);
  assert.equal(detachedPreview.branch, null);
});
test("diff reports deletions empty binary and large files without reading symlink targets", async (t) => {
  const { root, repository } = await fixture(t);
  const c = await createCheckout({
    repository,
    workspaceId: "w",
    path: path.join(root, "special"),
    branch: "special",
    sourceRef: "main",
  });
  await rm(path.join(c.path, "hello.txt"));
  assert.match(
    (await readDiff(c.path, "hello.txt", "unstaged")).text,
    /deleted file/,
  );
  await writeFile(path.join(c.path, "empty"), "");
  assert.match((await readDiff(c.path, "empty", "untracked")).text, /Empty/);
  await writeFile(path.join(c.path, "large"), "x".repeat(1024 * 1024 + 1));
  assert.equal((await readDiff(c.path, "large", "untracked")).truncated, true);
});
test("canonical repository paths preserve trailing whitespace and newline directory names", async (t) => {
  const { root, main } = await fixture(t);
  const special = path.join(root, "main ü\n ");
  await import("node:fs/promises").then((fs) => fs.rename(main, special));
  const info = await registerRepository(special);
  assert.ok(info.path.endsWith("main ü\n "));
  const repository = { ...info, id: "repo-id", projectId: "p", key: "app" };
  const c = await createCheckout({
    repository,
    workspaceId: "w",
    path: path.join(root, "linked ü\n "),
    branch: "whitespace",
    sourceRef: "main",
  });
  assert.equal(
    (await adoptCheckout({ repository, workspaceId: "w", path: c.path })).path,
    c.path,
  );
  assert.equal((await inspectDestroy(c, repository)).path, c.path);
});
// Runtime churn and resource cleanup should not invalidate user-file consent; undeclared ignored data still must.
test("destroy isolates declared disposable scopes while keeping user and unknown ignored content in the fingerprint", async (t) => {
  const { root, main, repository } = await fixture(t);
  const c = await createCheckout({
    repository,
    workspaceId: "w",
    path: path.join(root, "runtime-disposable"),
    branch: "runtime-disposable",
    sourceRef: "main",
  });
  const before = await inspectDestroy(c, repository, ["runtime/cache"]);
  assert.equal(before.dirty, false);
  assert(
    before.files.some(
      (f) => f.path === "runtime/cache" && (f as any).disposable,
    ),
  );
  await mkdir(path.join(c.path, "runtime/cache"), { recursive: true });
  await writeFile(path.join(c.path, "runtime/cache/log"), "first");
  const running = await inspectDestroy(c, repository, ["runtime/cache"]);
  assert.equal(running.fingerprint, before.fingerprint);
  assert.equal(running.dirty, false);
  await writeFile(path.join(c.path, "runtime/cache/log"), "churn");
  assert.equal(
    (await inspectDestroy(c, repository, ["runtime/cache"])).fingerprint,
    before.fingerprint,
  );
  await mkdir(path.join(c.path, "ignored"));
  await writeFile(path.join(c.path, "ignored/user-data"), "private");
  const unknown = await inspectDestroy(c, repository, ["runtime/cache"]);
  assert.equal(unknown.dirty, true);
  assert.notEqual(unknown.fingerprint, before.fingerprint);
  await assert.rejects(
    removeCheckout(c, repository, unknown.fingerprint, false, [
      "runtime/cache",
    ]),
    { code: "DIRTY_CHECKOUT" },
  );
  await rm(path.join(c.path, "ignored"), { recursive: true });
  await rm(path.join(c.path, "runtime"), { recursive: true });
  assert.equal(
    (await inspectDestroy(c, repository, ["runtime/cache"])).fingerprint,
    before.fingerprint,
  );
  await mkdir(path.join(c.path, "runtime/cache"), { recursive: true });
  await writeFile(path.join(c.path, "runtime/cache/log"), "new");
  await removeCheckout(c, repository, before.fingerprint, false, [
    "runtime/cache",
  ]);
  assert.ok(git(main, "rev-parse", "refs/heads/runtime-disposable"));
});
// A declaration must not convert tracked or aliased user content into disposable data.
test("destroy refuses root tracked and escaping symlink disposable declarations", async (t) => {
  const { root, repository } = await fixture(t);
  const c = await createCheckout({
    repository,
    workspaceId: "w",
    path: path.join(root, "bad-disposable"),
    branch: "bad-disposable",
    sourceRef: "main",
  });
  for (const scope of [".", "../outside", ".git", "hello.txt"])
    await assert.rejects(inspectDestroy(c, repository, [scope]), {
      code: "INVALID_INPUT",
    });
  await mkdir(path.join(root, "outside-data"));
  await symlink(
    path.join(root, "outside-data"),
    path.join(c.path, "linked-data"),
  );
  await assert.rejects(inspectDestroy(c, repository, ["linked-data"]), {
    code: "INVALID_INPUT",
  });
});
