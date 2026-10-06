import { mkdir, readFile, writeFile, access, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = resolve(
  process.argv.includes("--root")
    ? process.argv[process.argv.indexOf("--root") + 1]
    : "work/demo",
);
if (process.argv.indexOf("--root") < 0 && process.argv.length > 2)
  throw Error("Usage: npm run demo:prepare -- --root work/demo");
try {
  await access(root);
  throw Error("Demo target already exists; choose a fresh directory");
} catch (error: any) {
  if (error.code !== "ENOENT") throw error;
}
const source = resolve(fileURLToPath(new URL("../fixtures", import.meta.url)));
await mkdir(root, { recursive: true });
await writeFile(
  join(root, ".worktree-manager-fixture"),
  "Demo fixture created by Worktree Manager\n",
);
const port = (preferred: number) => ({
  preferred,
  min: preferred,
  max: preferred + 99,
});
const api = (repository: string) => ({
  id: "api",
  repository,
  executable: "node",
  args: ["api.mjs"],
  env: {
    PORT: "{{self.port}}",
    WORKSPACE_ID: "{{workspace.id}}",
    UI_ORIGIN: "{{service.ui.url}}",
  },
  port: port(8080),
  readiness: { type: "http", path: "/" },
});
const ui = (repository: string) => ({
  id: "ui",
  repository,
  executable: "node",
  args: ["ui.mjs"],
  env: {
    PORT: "{{self.port}}",
    WORKSPACE_ID: "{{workspace.id}}",
    API_URL: "{{service.api.url}}",
  },
  port: port(3000),
  dependsOn: [`service:${repository}/api`],
  readiness: { type: "http", path: "/marker" },
});
async function repo(path: string, files: Record<string, string>) {
  await mkdir(path, { recursive: true });
  for (const [name, content] of Object.entries(files))
    await writeFile(join(path, name), content);
  execFileSync("git", ["init", "-b", "main", path], { stdio: "ignore" });
  execFileSync("git", ["-C", path, "add", "."]);
  execFileSync(
    "git",
    [
      "-C",
      path,
      "-c",
      "user.name=Worktree demo",
      "-c",
      "user.email=demo@localhost",
      "commit",
      "-m",
      "Initial demo stack",
    ],
    { stdio: "ignore" },
  );
}
const apiSource = await readFile(join(source, "demo-stack/api.mjs"), "utf8"),
  uiSource = await readFile(join(source, "demo-stack/ui.mjs"), "utf8");
const simple = join(root, "demo-stack");
await repo(simple, {
  "api.mjs": apiSource,
  "ui.mjs": uiSource,
  "README.md":
    "# Demo stack\nRun node api.mjs and node ui.mjs. PORT, API_URL, UI_ORIGIN, WORKSPACE_ID are per-instance inputs.\n",
  ".gitignore": ".data/\n.ready\n",
});
const manifest = {
  schemaVersion: 1,
  name: "Demo stack",
  repositories: [{ key: "app", path: ".", sourceRef: "main" }],
  prerequisites: [{ id: "node", executable: "node", args: ["--version"] }],
  services: [api("app"), ui("app")],
  entrypoints: [{ label: "Open demo", service: "app/ui" }],
};
await writeFile(
  join(simple, "worktree.project.json"),
  JSON.stringify(manifest, null, 2),
);
execFileSync("git", ["-C", simple, "add", "."]);
execFileSync(
  "git",
  [
    "-C",
    simple,
    "-c",
    "user.name=Worktree demo",
    "-c",
    "user.email=demo@localhost",
    "commit",
    "-m",
    "Add workspace configuration",
  ],
  { stdio: "ignore" },
);
const multi = join(root, "multi-repo");
await repo(join(multi, "backend"), {
  "api.mjs": apiSource,
  "data.mjs": await readFile(join(source, "multi-repo/data.mjs"), "utf8"),
  ".gitignore": ".data/\n",
  "README.md":
    "# Backend\nAPI uses DATA_URL. data.mjs is a per-instance local data service.\n",
});
await repo(join(multi, "frontend"), {
  "ui.mjs": uiSource,
  "README.md": "# Frontend\nnode ui.mjs uses PORT and API_URL.\n",
});
await writeFile(
  join(multi, "worktree.project.json"),
  JSON.stringify(
    {
      ...manifest,
      name: "Collaborating repositories",
      repositories: [
        { key: "backend", path: "backend", sourceRef: "main" },
        { key: "frontend", path: "frontend", sourceRef: "main" },
      ],
      bindings: { "backend/ui": "frontend/ui", "frontend/api": "backend/api" },
      services: [
        {
          ...api("backend"),
          env: { ...api("backend").env, DATA_URL: "{{resource.db.url}}" },
          dependsOn: ["resource:db"],
        },
        { ...ui("frontend"), dependsOn: ["service:backend/api"] },
      ],
      resources: [
        {
          id: "db",
          repository: "backend",
          adapter: "process",
          executable: "node",
          args: ["data.mjs"],
          env: { PORT: "{{self.port}}", WORKSPACE_ID: "{{workspace.id}}" },
          port: port(9000),
          disposablePaths: [".data"],
        },
      ],
      entrypoints: [{ label: "Open frontend", service: "frontend/ui" }],
    },
    null,
    2,
  ),
);
const mono = join(root, "monorepo");
await repo(mono, {
  "worker.mjs": await readFile(join(source, "monorepo/worker.mjs"), "utf8"),
  "README.md":
    "# Batch processor\nnode worker.mjs runs the foreground worker. No network port.\n",
});
await writeFile(
  join(mono, "worktree.project.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      name: "Background worker",
      repositories: [{ key: "jobs", path: "." }],
      prerequisites: manifest.prerequisites,
      services: [
        {
          id: "queue",
          repository: "jobs",
          executable: "node",
          args: ["worker.mjs"],
          env: { WORKSPACE_ID: "{{workspace.id}}" },
          readiness: { type: "process" },
        },
      ],
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    { root: await realpath(root), projects: [simple, multi, mono] },
    null,
    2,
  ),
);
