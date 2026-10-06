import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createGhClient } from "../packages/controller/src/github/cli.js";
import {
  discoverRemote,
  listPullRequests,
  readPullRequest,
} from "../packages/controller/src/github/pullRequests.js";
async function fixture(t: any) {
  const root = await mkdtemp(path.join(os.tmpdir(), "manager github "));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["-C", root, "init", "-b", "feature"]);
  execFileSync("git", [
    "-C",
    root,
    "remote",
    "add",
    "origin",
    "git@github.com:fork/app.git",
  ]);
  execFileSync("git", [
    "-C",
    root,
    "remote",
    "add",
    "upstream",
    "https://github.com/base/app.git",
  ]);
  return root;
}
const pr = (n: number, state = "OPEN", owner = "fork") => ({
  number: n,
  title: `PR ${n}`,
  state,
  isDraft: n === 1,
  url: `https://github.com/base/app/pull/${n}`,
  headRefName: "feature",
  headRefOid: "a".repeat(40),
  baseRefName: "main",
  baseRefOid: "b".repeat(40),
  headRepository: { name: "app" },
  headRepositoryOwner: { login: owner },
  updatedAt: "2026-10-06T00:00:00Z",
});
test("lists all PR states while excluding same-name branches from other forks", async (t) => {
  const root = await fixture(t);
  const calls: string[][] = [];
  const client = createGhClient({
    run: async (args) => {
      calls.push(args);
      return {
        stdout:
          args[0] === "auth"
            ? ""
            : JSON.stringify(
                args.includes("github.com/base/app")
                  ? [
                      pr(1),
                      pr(2, "MERGED"),
                      pr(3, "CLOSED"),
                      pr(4, "OPEN", "another"),
                    ]
                  : [],
              ),
        code: 0,
      };
    },
  });
  assert.equal((await discoverRemote(root)).headRepository.owner, "fork");
  const result = await listPullRequests(root, "feature", { client });
  assert.equal(result.status, "available");
  if (result.status === "available") {
    assert.deepEqual(
      result.pullRequests.map((p) => p.state),
      ["OPEN", "MERGED", "CLOSED"],
    );
    assert.equal(result.truncated, false);
  }
  assert.ok(calls.some((args) => args.includes("all")));
  assert.ok(calls.every((args) => ["auth", "pr", "api"].includes(args[0]!)));
});
test("missing CLI authentication network and unsupported host remain unavailable rather than empty matches", async (t) => {
  const root = await fixture(t);
  for (const [stderr, expected] of [
    ["gh: command not found", "missing-cli"],
    ["not logged into any GitHub hosts", "authentication"],
    ["could not resolve host github.com", "network"],
  ] as const) {
    const client = createGhClient({
      run: async () => ({ stdout: "", stderr, code: 1 }),
    });
    const result = await listPullRequests(root, "feature", { client });
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable") assert.equal(result.reason, expected);
  }
  execFileSync("git", [
    "-C",
    root,
    "remote",
    "set-url",
    "origin",
    "https://gitlab.com/fork/app.git",
  ]);
  const unsupported = await listPullRequests(root, "feature");
  assert.equal(unsupported.status, "unavailable");
  if (unsupported.status === "unavailable")
    assert.equal(unsupported.reason, "unsupported-host");
});
test("detail rejects changing commit snapshots and returns actual commits files and diff for a stable snapshot", async (t) => {
  const root = await fixture(t);
  let views = 0;
  const stable = createGhClient({
    run: async (args) => ({
      stdout:
        args[1] === "diff"
          ? "diff --git a/a b/a\n+remote change"
          : JSON.stringify({
              ...pr(1),
              commits: [
                { oid: "a".repeat(40), messageHeadline: "remote commit" },
              ],
              files: [{ path: "a" }],
            }),
      code: 0,
    }),
  });
  const result = await readPullRequest(root, 1, {
    client: stable,
    repository: "github.com/base/app",
  });
  assert.equal(result.status, "available");
  if (result.status === "available") {
    assert.match(result.diff.text, /remote change/);
    assert.equal(result.pullRequest.commits.length, 1);
    assert.equal(result.headCommit, "a".repeat(40));
  }
  const changing = createGhClient({
    run: async (args) => ({
      stdout:
        args[1] === "diff"
          ? "diff"
          : JSON.stringify({
              ...pr(1),
              headRefOid: (++views).toString(16).padStart(40, "0"),
              commits: [],
              files: [],
            }),
      code: 0,
    }),
  });
  const mismatch = await readPullRequest(root, 1, {
    client: changing,
    repository: "github.com/base/app",
  });
  assert.equal(mismatch.status, "unavailable");
  if (mismatch.status === "unavailable")
    assert.equal(mismatch.reason, "snapshot-mismatch");
});
test("candidate limit switches to paginated API so additional PRs are not silently lost", async (t) => {
  const root = await fixture(t);
  const client = createGhClient({
    run: async (args) => {
      if (args[0] === "auth") return { stdout: "", code: 0 };
      if (args[0] === "pr")
        return {
          stdout: JSON.stringify(
            args.includes("github.com/base/app")
              ? Array.from({ length: 100 }, (_, i) => pr(i + 1))
              : [],
          ),
          code: 0,
        };
      const page = args.find((a) => a.includes("page="))!;
      const rows = page.endsWith("page=1")
        ? Array.from({ length: 100 }, (_, i) => ({
            number: i + 1,
            title: `PR ${i + 1}`,
            state: "open",
            head: {
              ref: "feature",
              sha: "a".repeat(40),
              repo: { name: "app", owner: { login: "fork" } },
            },
            base: { ref: "main", sha: "b".repeat(40) },
          }))
        : [
            {
              number: 101,
              title: "extra",
              state: "closed",
              merged_at: "now",
              head: {
                ref: "feature",
                sha: "a".repeat(40),
                repo: { name: "app", owner: { login: "fork" } },
              },
              base: { ref: "main", sha: "b".repeat(40) },
            },
          ];
      return { stdout: JSON.stringify(rows), code: 0 };
    },
  });
  const result = await listPullRequests(root, "feature", { client });
  assert.equal(result.status, "available");
  if (result.status === "available") {
    assert.equal(result.pullRequests.length, 101);
    assert.equal(result.truncated, false);
  }
});
