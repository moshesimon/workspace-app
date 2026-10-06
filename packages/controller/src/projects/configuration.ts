import { randomUUID, createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { validateConfiguration } from "../../../contracts/src/project-configuration.js";
import type {
  ConfigurationRevision,
  Project,
  Repository,
} from "../../../contracts/src/models.js";
import { DomainError } from "../../../contracts/src/errors.js";
import { Store } from "../store.js";
import { registerRepository } from "../git/worktrees.js";
export { validateConfiguration };
export async function containedRepository(root: string, path: string) {
  const canonical = await realpath(resolve(root, path));
  const rel = relative(root, canonical);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new DomainError(
      "INVALID_INPUT",
      "Repository symlink escapes project root",
    );
  return canonical;
}
export async function importConfiguration(
  store: Store,
  project: Project,
  input: unknown,
): Promise<ConfigurationRevision> {
  const manifest = validateConfiguration(input);
  const repos: Repository[] = [];
  for (const entry of manifest.repositories) {
    const path = await containedRepository(project.root, entry.path);
    const info = await registerRepository(path);
    if (info.path !== path)
      throw new DomainError(
        "INVALID_INPUT",
        `${entry.path} is not a repository root`,
      );
    const old = store
      .all<Repository>("repositories")
      .find((r) => r.projectId === project.id && r.key === entry.key);
    if (
      old &&
      old.commonDir !== info.commonDir &&
      store
        .all("checkouts")
        .some((c) => c.repositoryId === old.id && !c.removedAt)
    )
      throw new DomainError(
        "CONFIGURATION_CHANGED",
        "Cannot replace repository identity while checkouts reference it",
      );
    repos.push({
      id: old?.id ?? randomUUID(),
      projectId: project.id,
      key: entry.key,
      ...info,
    });
  }
  const hash = createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex");
  let revision = store
    .all<ConfigurationRevision>("configuration_revisions")
    .find((r) => r.projectId === project.id && r.hash === hash);
  if (!revision) {
    revision = {
      id: randomUUID(),
      projectId: project.id,
      manifest,
      hash,
      createdAt: new Date().toISOString(),
    };
    store.put("configuration_revisions", revision);
  }
  for (const repo of repos) store.put("repositories", repo);
  project.configurationRevisionId = revision.id;
  store.put("projects", project);
  return revision;
}
export function exportConfiguration(store: Store, project: Project) {
  return store.get<ConfigurationRevision>(
    "configuration_revisions",
    project.configurationRevisionId,
  )?.manifest;
}
