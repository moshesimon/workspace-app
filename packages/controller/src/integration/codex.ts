import { randomUUID, createHash } from "node:crypto";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import { DomainError } from "../../../contracts/src/errors.js";
import type { Store } from "../store.js";
const BEGIN = "# BEGIN worktree-manager managed integration";
const END = "# END worktree-manager managed integration";
const ACTIVE = "codex-active-install";
const digest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
interface Snapshot {
  path: string;
  before: string | null;
  hash: string;
  mode: number;
}
interface Change {
  path: string;
  before: string | null;
  after: string | null;
  mode: number;
}
interface Conflict {
  path: string;
  message: string;
}
interface Installation {
  id: string;
  kind: "installation";
  configPath: string;
  skillPath: string;
  executable: string;
  block: string;
  files: Array<{ path: string; hash: string }>;
  backups: string[];
  connectedAt: string;
  directories: string[];
  disconnectedAt?: string;
}
interface IntegrationResult {
  connected: boolean;
  partial: boolean;
  conflicts: Conflict[];
  changes: string[];
  backups: string[];
}
interface Preview {
  id: string;
  kind: "preview";
  action: "connect" | "disconnect";
  changes: Change[];
  conflicts: Conflict[];
  expiresAt: string;
  watchers: Snapshot[];
  bundleHash: string | null;
  skillTreeHash: string;
  installation?: Installation;
  block: string;
  directories: string[];
  applied?: boolean;
  result?: IntegrationResult;
}
async function snapshot(file: string): Promise<Snapshot> {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new DomainError(
        "UNSAFE_INTEGRATION_PATH",
        "Integration file must be a regular file",
        { path: file },
      );
    const data = await readFile(file);
    return {
      path: file,
      before: data.toString("utf8"),
      hash: digest(data),
      mode: stat.mode & 0o777,
    };
  } catch (e: any) {
    if (e.code === "ENOENT")
      return { path: file, before: null, hash: "missing", mode: 0o600 };
    throw e;
  }
}
function document(text: string | null) {
  try {
    return parse(text ?? "");
  } catch (e: any) {
    throw new DomainError(
      "INVALID_CODEX_CONFIGURATION",
      `Codex configuration is invalid TOML: ${e.message}`,
    );
  }
}
function server(text: string | null) {
  return (document(text).mcp_servers as Record<string, unknown> | undefined)?.[
    "worktree-manager"
  ];
}
function ownsServer(text: string | null, installation: Installation) {
  return (
    !!installation.block &&
    !!text?.includes(installation.block) &&
    JSON.stringify(server(text)) === JSON.stringify(server(installation.block))
  );
}
async function safePath(file: string, root: string) {
  const relative = path.relative(root, file);
  if (
    relative === ".." ||
    relative.startsWith("../") ||
    path.isAbsolute(relative)
  )
    throw new DomainError(
      "UNSAFE_INTEGRATION_PATH",
      "Integration path escaped installation root",
    );
  let current = root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new DomainError(
          "UNSAFE_INTEGRATION_PATH",
          "Integration cannot overwrite symlinks",
          { path: current },
        );
    } catch (e: any) {
      if (e.code === "ENOENT") break;
      throw e;
    }
  }
}
async function inventory(
  root: string,
): Promise<
  Array<{ relative: string; data: string; hash: string; mode: number }>
> {
  const entries: Array<{
    relative: string;
    data: string;
    hash: string;
    mode: number;
  }> = [];
  let count = 0;
  async function walk(directory: string) {
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch (e: any) {
      if (e.code === "ENOENT" && directory === root) return;
      throw e;
    }
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++count > 1000)
        throw new DomainError(
          "INTEGRATION_TOO_LARGE",
          "Skill installation exceeds file limit",
        );
      const filename = path.join(directory, child.name);
      if (child.isSymbolicLink())
        throw new DomainError(
          "UNSAFE_INTEGRATION_PATH",
          "Skill installation cannot contain symlinks",
          { path: filename },
        );
      if (child.isDirectory()) await walk(filename);
      else if (child.isFile()) {
        const stat = await lstat(filename);
        if (stat.size > 2 * 1024 * 1024)
          throw new DomainError(
            "INTEGRATION_TOO_LARGE",
            "Skill file exceeds size limit",
            { path: filename },
          );
        const data = await readFile(filename);
        if (data.includes(0))
          throw new DomainError(
            "INVALID_SKILL",
            "Bundled skill must contain text resources",
          );
        entries.push({
          relative: path.relative(root, filename),
          data: data.toString("utf8"),
          hash: digest(data),
          mode: stat.mode & 0o777,
        });
      } else
        throw new DomainError(
          "UNSAFE_INTEGRATION_PATH",
          "Special files cannot be installed",
        );
    }
  }
  await walk(root);
  return entries;
}
const treeHash = (
  items: Array<{ relative: string; hash: string; mode: number }>,
) =>
  digest(
    JSON.stringify(
      items.map(({ relative, hash, mode }) => ({ relative, hash, mode })),
    ),
  );
async function atomic(file: string, text: string, mode: number) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, "wx", mode);
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporary, mode);
    await rename(temporary, file);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}
export class CodexIntegration {
  readonly configPath: string;
  readonly skillPath: string;
  readonly executable: string;
  readonly skillRoot: string;
  readonly codexHome: string;
  readonly agentsHome: string;
  constructor(
    private store: Store,
    options: {
      executable?: string;
      skillRoot?: string;
      codexHome?: string;
      agentsHome?: string;
    } = {},
  ) {
    this.codexHome = path.resolve(
      options.codexHome ??
        process.env.CODEX_HOME ??
        path.join(homedir(), ".codex"),
    );
    this.agentsHome = path.resolve(
      options.agentsHome ?? path.join(homedir(), ".agents"),
    );
    this.configPath = path.join(this.codexHome, "config.toml");
    this.skillPath = path.join(this.agentsHome, "skills", "worktree-manager");
    this.executable = path.resolve(options.executable ?? process.execPath);
    this.skillRoot = path.resolve(
      options.skillRoot ??
        path.join(process.cwd(), "skills", "worktree-manager"),
    );
  }
  private active() {
    const record = this.store.get<Installation>("integration_installs", ACTIVE);
    return record?.kind === "installation" &&
      record.configPath === this.configPath &&
      record.skillPath === this.skillPath
      ? record
      : undefined;
  }
  private async executableProblem() {
    if (!/\.app\/Contents\/MacOS\/[^/]+$/.test(this.executable))
      return "Install the packaged application before connecting Codex; a development checkout is not a stable executable";
    try {
      const stat = await lstat(this.executable);
      if (!stat.isFile() || stat.isSymbolicLink())
        return "Installed executable must be a regular file";
      await access(this.executable, constants.X_OK);
      return null;
    } catch {
      return "Installed application executable is unavailable or not executable";
    }
  }
  async status() {
    const active = this.active();
    const config = await snapshot(this.configPath);
    const conflicts: Conflict[] = [];
    let connected = false;
    if (active) {
      connected = !active.disconnectedAt && ownsServer(config.before, active);
      if (!connected)
        conflicts.push({
          path: this.configPath,
          message: "Owned server block changed or is missing",
        });
      for (const file of active.files) {
        const current = await snapshot(file.path);
        if (current.hash !== file.hash) {
          connected = false;
          conflicts.push({
            path: file.path,
            message: "Owned skill file changed or is missing",
          });
        }
      }
    }
    return {
      connected,
      configPath: this.configPath,
      skillPath: this.skillPath,
      executable: this.executable,
      available: !(await this.executableProblem()),
      backups: active?.backups ?? [],
      conflicts,
    };
  }
  async preview(action: "connect" | "disconnect") {
    if (action !== "connect" && action !== "disconnect")
      throw new DomainError(
        "INVALID_INPUT",
        "Integration action must be connect or disconnect",
      );
    await safePath(this.configPath, this.codexHome);
    await safePath(this.skillPath, this.agentsHome);
    const config = await snapshot(this.configPath);
    document(config.before);
    const active = this.active();
    const changes: Change[] = [];
    const conflicts: Conflict[] = [];
    const watchers: Snapshot[] = [config];
    const targetFiles = await inventory(this.skillPath);
    let bundleHash: string | null = null,
      block = active?.block ?? "";
    const directories: string[] = [];
    if (action === "connect") {
      const problem = await this.executableProblem();
      if (problem) conflicts.push({ path: this.executable, message: problem });
      const sources = await inventory(this.skillRoot);
      if (!sources.some((item) => item.relative === "SKILL.md"))
        conflicts.push({
          path: this.skillRoot,
          message: "Bundled SKILL.md is missing",
        });
      bundleHash = treeHash(sources);
      if (active) {
        if (
          active.disconnectedAt ||
          active.executable !== this.executable ||
          !ownsServer(config.before, active)
        )
          conflicts.push({
            path: this.configPath,
            message:
              "Existing owned server entry changed; disconnect or resolve it before reconnecting",
          });
        for (const file of active.files) {
          const current = await snapshot(file.path);
          watchers.push(current);
          if (current.hash !== file.hash)
            conflicts.push({
              path: file.path,
              message:
                "Owned skill file changed; reconnect will not overwrite it",
            });
        }
        const intended = sources.map((item) => ({
          path: path.join(this.skillPath, item.relative),
          hash: item.hash,
        }));
        if (JSON.stringify(intended) !== JSON.stringify(active.files))
          conflicts.push({
            path: this.skillPath,
            message:
              "Bundled skill changed; disconnect before installing the new version",
          });
      } else {
        if (
          server(config.before) !== undefined ||
          config.before?.includes(BEGIN)
        )
          conflicts.push({
            path: this.configPath,
            message:
              "A same-name MCP server exists without this installation ownership",
          });
        if (
          targetFiles.length ||
          (await lstat(this.skillPath)
            .then(() => true)
            .catch((e: any) => {
              if (e.code === "ENOENT") return false;
              throw e;
            }))
        )
          conflicts.push({
            path: this.skillPath,
            message:
              "A same-name skill folder exists without this installation ownership",
          });
        block = `${config.before && !config.before.endsWith("\n") ? "\n" : ""}${BEGIN}\n[mcp_servers."worktree-manager"]\ncommand = ${JSON.stringify(this.executable)}\nargs = ["--mode=mcp"]\n${END}\n`;
        if (
          server(config.before) === undefined &&
          !config.before?.includes(BEGIN)
        ) {
          const after = (config.before ?? "") + block;
          document(after);
          changes.push({
            path: this.configPath,
            before: config.before,
            after,
            mode: config.mode,
          });
        }
        for (const source of sources) {
          const destination = path.join(this.skillPath, source.relative);
          await safePath(destination, this.agentsHome);
          const before = await snapshot(destination);
          watchers.push(before);
          changes.push({
            path: destination,
            before: before.before,
            after: source.data,
            mode: 0o644,
          });
          let directory = path.dirname(destination);
          while (
            directory === this.skillPath ||
            directory.startsWith(this.skillPath + path.sep)
          ) {
            if (!directories.includes(directory)) {
              try {
                await lstat(directory);
              } catch (e: any) {
                if (e.code !== "ENOENT") throw e;
                directories.push(directory);
              }
            }
            if (directory === this.skillPath) break;
            directory = path.dirname(directory);
          }
        }
      }
    } else if (active) {
      if (ownsServer(config.before, active)) {
        const after = config.before!.replace(active.block, "");
        document(after);
        changes.push({
          path: this.configPath,
          before: config.before,
          after,
          mode: config.mode,
        });
      } else if (active.block)
        conflicts.push({
          path: this.configPath,
          message: "Owned MCP server block changed; preserving it",
        });
      for (const file of active.files) {
        await safePath(file.path, this.agentsHome);
        const before = await snapshot(file.path);
        watchers.push(before);
        if (before.hash === file.hash)
          changes.push({
            path: file.path,
            before: before.before,
            after: null,
            mode: before.mode,
          });
        else if (before.before !== null)
          conflicts.push({
            path: file.path,
            message: "Owned skill file changed; preserving it",
          });
      }
    }
    const preview: Preview = {
      id: randomUUID(),
      kind: "preview",
      action,
      changes,
      conflicts,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      watchers,
      bundleHash,
      skillTreeHash: treeHash(targetFiles),
      installation: active,
      block,
      directories,
    };
    this.store.put("integration_installs", preview);
    return {
      id: preview.id,
      action,
      changes: changes.map(({ path, before, after }) => ({
        path,
        before,
        after,
      })),
      conflicts,
      expiresAt: preview.expiresAt,
    };
  }
  async apply(previewId: string): Promise<IntegrationResult> {
    const preview = this.store.get<Preview>("integration_installs", previewId);
    if (!preview || preview.kind !== "preview")
      throw new DomainError("NOT_FOUND", "Integration preview not found");
    if (preview.applied && preview.result) return preview.result;
    if (Date.parse(preview.expiresAt) < Date.now())
      throw new DomainError("STALE_PREVIEW", "Integration preview expired");
    if (preview.action === "connect" && preview.conflicts.length)
      throw new DomainError(
        "INTEGRATION_CONFLICT",
        "Resolve integration conflicts before connecting",
        preview.conflicts,
      );
    // All watched configuration/source/target inputs are checked before the first write.
    await safePath(this.configPath, this.codexHome);
    await safePath(this.skillPath, this.agentsHome);
    for (const expected of preview.watchers) {
      await safePath(
        expected.path,
        expected.path === this.configPath ? this.codexHome : this.agentsHome,
      );
      const current = await snapshot(expected.path);
      if (current.hash !== expected.hash || current.mode !== expected.mode)
        throw new DomainError(
          "STALE_PREVIEW",
          "Integration file changed after preview",
          { path: expected.path },
        );
    }
    if (treeHash(await inventory(this.skillPath)) !== preview.skillTreeHash)
      throw new DomainError(
        "STALE_PREVIEW",
        "Skill installation changed after preview",
      );
    if (preview.action === "connect") {
      if (await this.executableProblem())
        throw new DomainError(
          "STALE_PREVIEW",
          "Installed executable changed after preview",
        );
      if (treeHash(await inventory(this.skillRoot)) !== preview.bundleHash)
        throw new DomainError(
          "STALE_PREVIEW",
          "Bundled skill changed after preview",
        );
    }
    if (JSON.stringify(this.active()) !== JSON.stringify(preview.installation))
      throw new DomainError(
        "STALE_PREVIEW",
        "Installation ownership changed after preview",
      );
    const completed: Change[] = [];
    const backups: string[] = [];
    const backupRoot = path.join(
      this.store.root,
      "integration-backups",
      preview.id,
    );
    try {
      for (let index = 0; index < preview.changes.length; index++) {
        const change = preview.changes[index]!;
        await safePath(
          change.path,
          change.path === this.configPath ? this.codexHome : this.agentsHome,
        );
        const current = await snapshot(change.path);
        if (current.before !== change.before)
          throw new DomainError(
            "STALE_PREVIEW",
            "Integration file changed before write",
            { path: change.path },
          );
        if (change.before !== null) {
          const backup = path.join(backupRoot, `${index}.backup`);
          await mkdir(backupRoot, { recursive: true, mode: 0o700 });
          await writeFile(backup, change.before, { mode: 0o600, flag: "wx" });
          backups.push(backup);
        }
        if (change.after === null) await rm(change.path);
        else await atomic(change.path, change.after, change.mode);
        completed.push(change);
      }
      if (preview.action === "connect" && !preview.installation) {
        const installation: Installation = {
          id: ACTIVE,
          kind: "installation",
          configPath: this.configPath,
          skillPath: this.skillPath,
          executable: this.executable,
          block: preview.block,
          files: preview.changes
            .filter(
              (change) =>
                change.path !== this.configPath && change.after !== null,
            )
            .map((change) => ({
              path: change.path,
              hash: digest(change.after!),
            })),
          backups,
          connectedAt: new Date().toISOString(),
          directories: preview.directories,
        };
        this.store.put("integration_installs", installation);
      } else if (preview.action === "disconnect" && preview.installation) {
        for (const directory of [...preview.installation.directories].sort(
          (a, b) => b.length - a.length,
        )) {
          await safePath(directory, this.agentsHome);
          try {
            await rmdir(directory);
          } catch (e: any) {
            if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(e.code)) throw e;
          }
        }
        if (preview.conflicts.length)
          this.store.put("integration_installs", {
            ...preview.installation,
            block: preview.conflicts.some(
              (item) => item.path === this.configPath,
            )
              ? preview.installation.block
              : "",
            files: preview.installation.files.filter((file) =>
              preview.conflicts.some((item) => item.path === file.path),
            ),
            backups: [...preview.installation.backups, ...backups],
            disconnectedAt: new Date().toISOString(),
          });
        else this.store.delete("integration_installs", ACTIVE);
      }
      const result = {
        connected: preview.action === "connect",
        partial: preview.conflicts.length > 0,
        conflicts: preview.conflicts,
        changes: completed.map((change) => change.path),
        backups,
      };
      preview.applied = true;
      preview.result = result;
      this.store.put("integration_installs", preview);
      return result;
    } catch (error) {
      const failures: Array<{ path: string; message: string }> = [];
      for (const change of completed.reverse()) {
        try {
          const current = await snapshot(change.path);
          if (current.before !== change.after)
            throw new Error(
              "File changed after write; preserving current contents",
            );
          if (change.before === null) await rm(change.path, { force: true });
          else await atomic(change.path, change.before, change.mode);
        } catch (e: any) {
          failures.push({ path: change.path, message: e.message });
        }
      }
      if (preview.installation)
        this.store.put("integration_installs", preview.installation);
      else this.store.delete("integration_installs", ACTIVE);
      if (failures.length)
        throw new DomainError(
          "INTEGRATION_ROLLBACK_PARTIAL",
          "Integration failed and some changed files could not be restored",
          {
            error: error instanceof Error ? error.message : String(error),
            failures,
            backups,
          },
        );
      throw error;
    }
  }
}
