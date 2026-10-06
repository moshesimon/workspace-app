import { _electron as electron } from "playwright";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { ControllerClient } from "../packages/client/src/connect.js";
const root = await mkdtemp(join(tmpdir(), "wm-desktop-"));
const stateRoot = join(root, "state"),
  repo = join(root, "repo");
await mkdir(repo);
await writeFile(join(repo, "README.md"), "# Desktop verification\n");
execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
execFileSync("git", ["-C", repo, "add", "."]);
execFileSync(
  "git",
  [
    "-C",
    repo,
    "-c",
    "user.name=Verification",
    "-c",
    "user.email=verify@localhost",
    "commit",
    "-m",
    "Initial",
  ],
  { stdio: "ignore" },
);
const executable =
  process.env.WM_PACKAGED_EXECUTABLE ??
  resolve(
    "release/mac-arm64/Worktree Manager.app/Contents/MacOS/Worktree Manager",
  );
let app: Awaited<ReturnType<typeof electron.launch>> | undefined,
  pid: number | undefined;
try {
  app = await electron.launch({
    executablePath: executable,
    env: { ...process.env, WORKTREE_MANAGER_HOME: stateRoot },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("heading", { name: "Workspaces" }).waitFor();
  const client = new ControllerClient(stateRoot);
  const status = await client.call("controller.status");
  pid = status.pid;
  assert.equal(status.protocolVersion, 1);
  const operation = await page.evaluate(async (root) => {
    return (window as any).worktree.call("projects.register", {
      root,
      idempotencyKey: crypto.randomUUID(),
    });
  }, repo);
  const registered = await client.call("operations.wait", {
    operationId: operation.id,
  });
  assert.equal(
    registered.status,
    "succeeded",
    JSON.stringify(registered.error),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "New workspace", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Workspace name" })
    .fill("Desktop smoke");
  await page.getByRole("textbox", { name: "New branch" }).fill("desktop-smoke");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Desktop smoke" })
    .waitFor({ timeout: 15000 });
  const workspaces = await client.call("workspaces.list");
  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0].checkouts[0].createdBranch, "desktop-smoke");
  await mkdir("work/verification", { recursive: true });
  await page.screenshot({
    path: resolve("work/verification/desktop.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await app.close();
  app = undefined;
  const after = await client.call("controller.status");
  assert.equal(
    after.pid,
    pid,
    "Closing desktop must preserve controller identity",
  );
  app = await electron.launch({
    executablePath: executable,
    env: { ...process.env, WORKTREE_MANAGER_HOME: stateRoot },
    timeout: 30000,
  });
  const reopened = await app.firstWindow();
  await reopened
    .getByRole("button", { name: "Desktop smoke", exact: true })
    .waitFor();
  assert.equal((await client.call("controller.status")).pid, pid);
  await app.close();
  app = undefined;
  console.log(
    JSON.stringify(
      {
        desktop: "passed",
        packagedExecutable: executable,
        controllerPid: pid,
        windowReopen: "same controller",
        screenshot: resolve("work/verification/desktop.png"),
      },
      null,
      2,
    ),
  );
} catch (e) {
  try {
    console.error(await readFile(join(stateRoot, "controller.log"), "utf8"));
  } catch {}
  throw e;
} finally {
  if (app) await app.close();
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 200));
  await rm(root, { recursive: true, force: true });
}
