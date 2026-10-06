import { readFile, mkdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { connectOrStart } from "../packages/client/src/connect.js";
const root = resolve("work/demo"),
  stateRoot = resolve("work/demo-state");
try {
  await access(join(root, ".worktree-manager-fixture"));
} catch {
  execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/demo.ts", "--root", root],
    { stdio: "inherit" },
  );
}
const executable = resolve(
  "release/mac-arm64/Worktree Manager.app/Contents/MacOS/Worktree Manager",
);
await access(executable);
const client = await connectOrStart({
  stateRoot,
  executable,
  args: ["--mode=controller"],
});
async function action(name: string, input: Record<string, unknown>) {
  let op = await client.call(name, { ...input, idempotencyKey: randomUUID() });
  while (["queued", "running"].includes(op.status))
    op = await client.call("operations.wait", {
      operationId: op.id,
      timeoutMs: 25000,
    });
  if (op.status !== "succeeded")
    throw Error(JSON.stringify(op.error ?? op.result));
  return op.result;
}
try {
  const manifest = JSON.parse(
    await readFile(join(root, "multi-repo/worktree.project.json"), "utf8"),
  );
  manifest.name = "Demo · full stack";
  let project = (await client.call("projects.list")).find(
    (p: any) => p.name === manifest.name,
  );
  if (!project)
    project = (
      await action("projects.register", {
        root: join(root, "multi-repo"),
        name: manifest.name,
        manifest,
      })
    ).project;
  const names = ["Checkout redesign", "API sandbox"];
  const results = [];
  for (const [index, name] of names.entries()) {
    let workspace = (
      await client.call("workspaces.list", { projectId: project.id })
    ).find((w: any) => w.name === name);
    if (!workspace)
      workspace = (
        await action("workspaces.create", {
          projectId: project.id,
          name,
          branch: `demo/${index ? "api-sandbox" : "checkout-redesign"}`,
        })
      ).workspace;
    await action("lifecycle.start", { workspaceId: workspace.id });
    await action("lifecycle.refresh", { workspaceId: workspace.id });
    const detail = await client.call("workspaces.get", {
      workspaceId: workspace.id,
    });
    const ui = detail.services.find((s: any) => s.logicalId === "ui");
    const marker = await fetch(new URL("/marker", ui.url)).then((r) =>
      r.json(),
    );
    if (
      marker.workspace !== workspace.id ||
      marker.backend.workspace !== workspace.id ||
      marker.backend.resource.workspace !== workspace.id
    )
      throw Error("Demo routing marker mismatch");
    results.push({
      name,
      workspaceId: workspace.id,
      url: ui.url,
      ports: detail.services.map((s: any) => ({
        service: s.logicalId,
        port: s.assignedPort,
      })),
      database: detail.resources.map((r: any) => ({
        namespace: r.namespace,
        port: r.assignedPort,
      })),
    });
  }
  await mkdir("work/verification", { recursive: true });
  const child = spawn(executable, [], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, WORKTREE_MANAGER_HOME: stateRoot },
  });
  child.unref();
  console.log(
    JSON.stringify(
      {
        app: executable,
        desktopPid: child.pid,
        stateRoot,
        workspaces: results,
      },
      null,
      2,
    ),
  );
} finally {
  client.dispose();
}
