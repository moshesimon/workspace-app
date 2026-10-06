import { ControllerClient } from "../packages/client/src/connect.js";
import { resolve, join } from "node:path";
import { readFile, writeFile, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const client = new ControllerClient(resolve("work/demo-state"));
const workspaces = await client.call("workspaces.list");
const workspace = workspaces.find((w: any) => w.name === "Checkout redesign");
if (workspace) {
  const frontend = workspace.checkouts.find(
    (c: any) => c.repositoryKey === "frontend",
  );
  const file = join(frontend.path, "ui.mjs");
  const text = await readFile(file, "utf8");
  if (text.includes("A stack of your own."))
    await writeFile(
      file,
      text.replace("A stack of your own.", "Checkout redesign preview."),
    );
  const notes = join(frontend.path, "demo-notes.md");
  try {
    await access(notes);
  } catch {
    await writeFile(
      notes,
      "# Checkout redesign\n\nDemo branch notes:\n- Inspect this untracked file in Changes.\n- Inspect the UI heading change beside it.\n- Each workspace calls its own API and data service.\n",
    );
  }
  const op = await client.call("lifecycle.refresh", {
    workspaceId: workspace.id,
    idempotencyKey: randomUUID(),
  });
  await client.call("operations.wait", { operationId: op.id });
}
