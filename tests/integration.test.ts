import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  chmod,
  access,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parse } from "smol-toml";
import { Store } from "../packages/controller/src/store.js";
import { CodexIntegration } from "../packages/controller/src/integration/codex.js";
async function fixture(t: any) {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex integration ü "));
  const store = new Store(path.join(root, "state"));
  t.after(() => {
    store.close();
    return rm(root, { recursive: true, force: true });
  });
  const codexHome = path.join(root, "codex"),
    agentsHome = path.join(root, "agents"),
    skillRoot = path.join(root, "bundle"),
    executable = path.join(
      root,
      "Worktree Manager.app",
      "Contents",
      "MacOS",
      "Worktree Manager",
    );
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, "#!/bin/sh\nexit 0\n");
  await chmod(executable, 0o755);
  await mkdir(codexHome);
  await mkdir(path.join(skillRoot, "references"), { recursive: true });
  await writeFile(
    path.join(skillRoot, "SKILL.md"),
    "---\nname: worktree-manager\ndescription: Use worktree manager for project workspaces.\n---\nRead [onboarding](references/onboarding.md).\n",
  );
  await writeFile(
    path.join(skillRoot, "references", "onboarding.md"),
    "Inspect project evidence.\n",
  );
  const configPath = path.join(codexHome, "config.toml"),
    skillPath = path.join(agentsHome, "skills", "worktree-manager");
  const original =
    '# keep this comment\nmodel = "existing"\n[mcp_servers.other]\ncommand = "other"\n';
  await writeFile(configPath, original);
  const integration = new CodexIntegration(store, {
    codexHome,
    agentsHome,
    skillRoot,
    executable,
  });
  return {
    root,
    store,
    integration,
    configPath,
    skillPath,
    original,
    executable,
    skillRoot,
    codexHome,
    agentsHome,
  };
}
test("connect previews exact files then atomically installs a stable executable and skill while preserving TOML comments", async (t) => {
  const f = await fixture(t);
  const preview = await f.integration.preview("connect");
  assert.equal(preview.conflicts.length, 0);
  assert.equal(preview.changes.length, 3);
  assert.equal(await readFile(f.configPath, "utf8"), f.original);
  await f.integration.apply(preview.id);
  const connected = await f.integration.status();
  assert.equal(connected.connected, true);
  const config = await readFile(f.configPath, "utf8");
  assert.ok(config.startsWith(f.original));
  assert.equal(
    (parse(config).mcp_servers as any)["worktree-manager"].command,
    f.executable,
  );
  assert.deepEqual(
    (parse(config).mcp_servers as any)["worktree-manager"].args,
    ["--mode=mcp"],
  );
  assert.equal(
    await readFile(
      path.join(f.skillPath, "references", "onboarding.md"),
      "utf8",
    ),
    "Inspect project evidence.\n",
  );
  assert.ok(connected.backups.length);
  const repeated = await f.integration.preview("connect");
  assert.equal(repeated.changes.length, 0);
  await f.integration.apply(repeated.id);
});
test("semantic same-name TOML entries and foreign skills are conflicts even with quoted dotted keys", async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.configPath,
    '# foreign\n"mcp_servers"."worktree-manager".command = "foreign"\n',
  );
  let preview = await f.integration.preview("connect");
  assert.ok(preview.conflicts.length);
  await assert.rejects(f.integration.apply(preview.id), {
    code: "INTEGRATION_CONFLICT",
  });
  await writeFile(f.configPath, f.original);
  await mkdir(f.skillPath, { recursive: true });
  await writeFile(path.join(f.skillPath, "SKILL.md"), "foreign skill");
  preview = await f.integration.preview("connect");
  assert.ok(preview.conflicts.length);
  await assert.rejects(f.integration.apply(preview.id), {
    code: "INTEGRATION_CONFLICT",
  });
  assert.equal(
    await readFile(path.join(f.skillPath, "SKILL.md"), "utf8"),
    "foreign skill",
  );
});
test("apply rejects stale configuration and source skill before any writes", async (t) => {
  const f = await fixture(t);
  let preview = await f.integration.preview("connect");
  await writeFile(f.configPath, f.original + "# new comment\n");
  await assert.rejects(f.integration.apply(preview.id), {
    code: "STALE_PREVIEW",
  });
  await assert.rejects(access(path.join(f.skillPath, "SKILL.md")));
  preview = await f.integration.preview("connect");
  await writeFile(
    path.join(f.skillRoot, "references", "onboarding.md"),
    "changed source\n",
  );
  await assert.rejects(f.integration.apply(preview.id), {
    code: "STALE_PREVIEW",
  });
  await assert.rejects(access(path.join(f.skillPath, "SKILL.md")));
});
test("disconnect removes unchanged ownership only preserving unrelated TOML edits and new skill files", async (t) => {
  const f = await fixture(t);
  await f.integration.apply((await f.integration.preview("connect")).id);
  await writeFile(
    f.configPath,
    (await readFile(f.configPath, "utf8")) + "\n[features]\nkeep = true\n",
  );
  await writeFile(path.join(f.skillPath, "unrelated.md"), "user added");
  const preview = await f.integration.preview("disconnect");
  assert.equal(preview.conflicts.length, 0);
  await f.integration.apply(preview.id);
  assert.equal((await f.integration.status()).connected, false);
  const config = await readFile(f.configPath, "utf8");
  assert.ok(config.startsWith(f.original));
  assert.equal((parse(config).features as any).keep, true);
  assert.equal(
    (parse(config).mcp_servers as any)["worktree-manager"],
    undefined,
  );
  assert.equal(
    await readFile(path.join(f.skillPath, "unrelated.md"), "utf8"),
    "user added",
  );
  await assert.rejects(access(path.join(f.skillPath, "SKILL.md")));
});
test("changed owned files are reported as conflicts and preserved on disconnect", async (t) => {
  const f = await fixture(t);
  await f.integration.apply((await f.integration.preview("connect")).id);
  await writeFile(path.join(f.skillPath, "SKILL.md"), "user edited");
  const preview = await f.integration.preview("disconnect");
  assert.ok(
    preview.conflicts.some((item: any) => item.path.endsWith("SKILL.md")),
  );
  await f.integration.apply(preview.id);
  assert.equal(
    await readFile(path.join(f.skillPath, "SKILL.md"), "utf8"),
    "user edited",
  );
  assert.equal(
    (parse(await readFile(f.configPath, "utf8")).mcp_servers as any)[
      "worktree-manager"
    ],
    undefined,
  );
});
test("development executables and invalid TOML cannot be installed", async (t) => {
  const f = await fixture(t);
  const development = new CodexIntegration(f.store, {
    codexHome: f.codexHome,
    agentsHome: f.agentsHome,
    skillRoot: f.skillRoot,
    executable: process.execPath,
  });
  const preview = await development.preview("connect");
  assert.ok(preview.conflicts.length);
  await assert.rejects(development.apply(preview.id), {
    code: "INTEGRATION_CONFLICT",
  });
  await writeFile(f.configPath, "broken = [");
  await assert.rejects(f.integration.preview("connect"), {
    code: "INVALID_CODEX_CONFIGURATION",
  });
});
test("partial file installation rolls back all completed writes and keeps backups", async (t) => {
  const f = await fixture(t);
  const preview = await f.integration.preview("connect");
  const put = f.store.put.bind(f.store);
  f.store.put = ((table: string, record: any) => {
    if (record.kind === "installation")
      throw new Error("simulated persistence failure");
    return put(table, record);
  }) as typeof f.store.put;
  await assert.rejects(
    f.integration.apply(preview.id),
    /simulated persistence failure/,
  );
  assert.equal(await readFile(f.configPath, "utf8"), f.original);
  await assert.rejects(access(path.join(f.skillPath, "SKILL.md")));
  await assert.rejects(
    access(path.join(f.skillPath, "references", "onboarding.md")),
  );
  assert.equal((await f.integration.status()).connected, false);
  f.store.put = put;
});
test("changed managed config block stays preserved during partial disconnect", async (t) => {
  const f = await fixture(t);
  await f.integration.apply((await f.integration.preview("connect")).id);
  const modified = (await readFile(f.configPath, "utf8")).replace(
    'args = ["--mode=mcp"]',
    'args = ["--mode=mcp", "--user-edit"]',
  );
  await writeFile(f.configPath, modified);
  const preview = await f.integration.preview("disconnect");
  assert.ok(preview.conflicts.some((item: any) => item.path === f.configPath));
  const result = await f.integration.apply(preview.id);
  assert.equal(result.partial, true);
  assert.equal(await readFile(f.configPath, "utf8"), modified);
  await assert.rejects(access(path.join(f.skillPath, "SKILL.md")));
});
test("bundled skill installs recursively with resolvable references and a schema-valid project example", async (t) => {
  const f = await fixture(t);
  const skillRoot = path.resolve("skills/worktree-manager");
  const integration = new CodexIntegration(f.store, {
    codexHome: f.codexHome,
    agentsHome: f.agentsHome,
    skillRoot,
    executable: f.executable,
  });
  await integration.apply((await integration.preview("connect")).id);
  const skill = await readFile(path.join(f.skillPath, "SKILL.md"), "utf8");
  for (const link of skill.matchAll(/\]\((references\/[^)]+)\)/g))
    await access(path.join(f.skillPath, link[1]!));
  const reference = await readFile(
    path.join(f.skillPath, "references", "project-configuration.md"),
    "utf8",
  );
  const example = reference.match(/```json\n([\s\S]+?)\n```/)![1]!;
  const { validateConfiguration } =
    await import("../packages/contracts/src/project-configuration.js");
  assert.equal(validateConfiguration(JSON.parse(example)).schemaVersion, 1);
});
test("extra server properties outside the bounded block preserve the edited server", async (t) => {
  const f = await fixture(t);
  await f.integration.apply((await f.integration.preview("connect")).id);
  const changed = (await readFile(f.configPath, "utf8")) + "enabled = false\n";
  await writeFile(f.configPath, changed);
  const preview = await f.integration.preview("disconnect");
  assert.ok(preview.conflicts.some((item: any) => item.path === f.configPath));
  await f.integration.apply(preview.id);
  assert.equal(await readFile(f.configPath, "utf8"), changed);
});
test("clean disconnect removes empty owned directories and permits reconnect", async (t) => {
  const f = await fixture(t);
  await f.integration.apply((await f.integration.preview("connect")).id);
  await f.integration.apply((await f.integration.preview("disconnect")).id);
  await assert.rejects(access(f.skillPath));
  const reconnect = await f.integration.preview("connect");
  assert.equal(reconnect.conflicts.length, 0);
  await f.integration.apply(reconnect.id);
  assert.equal((await f.integration.status()).connected, true);
});
