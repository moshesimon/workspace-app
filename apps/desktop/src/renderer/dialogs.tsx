import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  FileJson2,
  FolderOpen,
  GitBranch,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { errorMessage, list, query, useQuery, type RecordData } from "./api.js";
import { Badge, Empty, ErrorNotice, Loading, Modal } from "./components.js";
import type { RunAction } from "./App.js";

export function CreateWorkspace({
  projects,
  initialProject,
  run,
  onClose,
  onCreated,
}: {
  projects: RecordData[];
  initialProject?: string;
  run: RunAction;
  onClose: () => void;
  onCreated: (workspace: RecordData) => void;
}) {
  const [projectId, setProjectId] = useState(
    initialProject || projects[0]?.id || "",
  );
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const project = useQuery<RecordData>(projectId ? "projects.get" : null, {
    projectId,
  });
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await run("workspaces.create", {
        projectId,
        name: name.trim(),
        ...(branch.trim() ? { branch: branch.trim() } : {}),
        ...(sourceRef.trim() ? { sourceRef: sourceRef.trim() } : {}),
      });
      onCreated(result?.workspace || result);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="A new place to work"
      subtitle="Create isolated worktrees from your project’s repositories."
      onClose={busy ? () => {} : onClose}
    >
      <form onSubmit={create}>
        <div className="modal-body">
          <label className="field">
            Project
            <select
              disabled={busy}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Workspace name
            <input
              required
              autoComplete="off"
              placeholder="e.g. Improve checkout flow"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </label>
          <div className="form-two-columns">
            <label className="field">
              New branch<span className="optional">Optional</span>
              <input
                placeholder="Uses the workspace default"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="field">
              Source ref<span className="optional">Optional</span>
              <input
                placeholder="Uses each repository’s default"
                value={sourceRef}
                onChange={(event) => setSourceRef(event.target.value)}
                disabled={busy}
              />
            </label>
          </div>
          <div className="form-note">
            <GitBranch size={18} />
            <p>
              Grove records the selected source ref and commit at creation. Each
              repository gets its own linked worktree.
            </p>
          </div>
          <ErrorNotice message={project.error} />
          {project.data && (
            <div className="repository-preview">
              <h4>Included repositories</h4>
              {list(project.data.repositories).map((repository) => (
                <div key={repository.id || repository.key}>
                  <FolderOpen size={15} />
                  <strong>{repository.key}</strong>
                  <code>{repository.path}</code>
                </div>
              ))}
            </div>
          )}
          <ErrorNotice message={error} />
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={
              busy ||
              !name.trim() ||
              !projectId ||
              !!project.error ||
              project.loading
            }
          >
            {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
            {busy ? "Creating workspace…" : "Create workspace"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function defaultManifest(
  name: string,
  repositories: RecordData[],
  root: string,
) {
  return {
    schemaVersion: 1,
    name: name || "My project",
    repositories: repositories.map((repository, index) => ({
      key:
        repository.key ||
        String(repository.path || "")
          .split("/")
          .filter(Boolean)
          .pop() ||
        `repository-${index + 1}`,
      path:
        repository.path === root
          ? "."
          : String(repository.path || ".").startsWith(`${root}/`)
            ? repository.path.slice(root.length + 1)
            : repository.path || ".",
    })),
    prerequisites: [],
    setup: [],
    services: [],
    resources: [],
    bindings: {},
    entrypoints: [],
  };
}
export function ProjectDialog({
  project,
  version,
  run,
  onClose,
  onSaved,
}: {
  project?: RecordData;
  version: number;
  run: RunAction;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [root, setRoot] = useState(project?.root || "");
  const [name, setName] = useState(project?.name || "");
  const [report, setReport] = useState<RecordData>();
  const [manifest, setManifest] = useState("");
  const [validation, setValidation] = useState<RecordData>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [step, setStep] = useState<"folder" | "manifest">(
    project ? "manifest" : "folder",
  );
  const [proposedRoot, setProposedRoot] = useState<string>();
  const [configurationVersion, setConfigurationVersion] = useState(0);
  const existing = useQuery<RecordData>(
    project ? "projects.get" : null,
    { projectId: project?.id },
    version + configurationVersion,
  );
  useEffect(() => {
    if (existing.data?.configuration?.manifest)
      setManifest(
        JSON.stringify(existing.data.configuration.manifest, null, 2),
      );
    if (existing.data?.project?.root) setRoot(existing.data.project.root);
  }, [existing.data]);
  const chooseRebindingFolder = async () => {
    setError(undefined);
    setBusy(true);
    try {
      const chosen = await window.worktree.chooseFolder();
      if (chosen) setProposedRoot(chosen);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const rebindFolder = async () => {
    if (!project || !proposedRoot || proposedRoot === root) return;
    setError(undefined);
    setBusy(true);
    try {
      await run("projects.rebind", {
        projectId: project.id,
        root: proposedRoot,
      });
      setRoot(proposedRoot);
      setProposedRoot(undefined);
      setValidation(undefined);
      setConfigurationVersion((value) => value + 1);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const choose = async () => {
    setError(undefined);
    setBusy(true);
    try {
      const chosen = await window.worktree.chooseFolder();
      if (!chosen) return;
      setRoot(chosen);
      const discovered = await query<RecordData>("projects.discover", {
        root: chosen,
      });
      setReport(discovered);
      const proposedName =
        chosen.split("/").filter(Boolean).pop() || "My project";
      setName(proposedName);
      setManifest(
        JSON.stringify(
          defaultManifest(proposedName, list(discovered.repositories), chosen),
          null,
          2,
        ),
      );
      setValidation(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const validate = async () => {
    setError(undefined);
    setBusy(true);
    try {
      const parsed = JSON.parse(manifest);
      const checked = await query<RecordData>("configuration.validate", {
        manifest: parsed,
        ...(root ? { root } : {}),
      });
      setValidation(checked);
      return parsed;
    } catch (cause) {
      setValidation(undefined);
      setError(errorMessage(cause));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    const parsed = await validate();
    if (!parsed) return;
    setBusy(true);
    try {
      if (project)
        await run("configuration.import", {
          projectId: project.id,
          manifest: parsed,
        });
      else
        await run("projects.register", {
          root,
          name: name.trim() || parsed.name,
          manifest: parsed,
        });
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const exportManifest = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const value = project
        ? await query("configuration.export", { projectId: project.id })
        : JSON.parse(manifest);
      const blob = new Blob([JSON.stringify(value, null, 2) + "\n"], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "worktree.project.json";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    setError(undefined);
    try {
      const text = await file.text();
      JSON.parse(text);
      setManifest(text);
      setValidation(undefined);
      setStep("manifest");
    } catch (cause) {
      setError(`Could not read manifest: ${errorMessage(cause)}`);
    }
  };
  return (
    <Modal
      wide
      title={
        project ? `${project.name} configuration` : "Bring a project into Grove"
      }
      subtitle={
        project
          ? "Edit your portable manifest. Existing workspaces keep their pinned revision."
          : "Choose a local folder, inspect its repositories, and save a reusable configuration."
      }
      onClose={busy ? () => {} : onClose}
    >
      <div className="modal-body">
        <ErrorNotice message={error || existing.error} />
        {project && (
          <section className="repository-preview">
            <h4>Project folder</h4>
            <dl className="resource-facts">
              <dt>Current root</dt>
              <dd>
                <code>{root}</code>
              </dd>
              {proposedRoot && (
                <>
                  <dt>Selected root</dt>
                  <dd>
                    <code>{proposedRoot}</code>
                  </dd>
                </>
              )}
            </dl>
            <p className="small muted">
              Choose the project’s new location, then review the selected root
              before rebinding. The controller validates each repository and
              refuses projects with active workspaces. Configuration reloads
              after rebinding.
            </p>
            <div className="settings-actions">
              <button
                className="button"
                disabled={busy}
                onClick={() => void chooseRebindingFolder()}
              >
                <FolderOpen size={14} />
                Choose new folder
              </button>
              {proposedRoot && (
                <button
                  className="button primary"
                  disabled={busy || proposedRoot === root}
                  onClick={() => void rebindFolder()}
                >
                  <Check size={14} />
                  Rebind folder
                </button>
              )}
            </div>
          </section>
        )}
        {!project && (
          <div className="onboarding-steps">
            <button
              className={step === "folder" ? "active" : ""}
              onClick={() => setStep("folder")}
            >
              <span>1</span>Project folder
            </button>
            <ChevronStep />
            <button
              className={step === "manifest" ? "active" : ""}
              disabled={!root}
              onClick={() => setStep("manifest")}
            >
              <span>2</span>Configuration
            </button>
          </div>
        )}
        {step === "folder" ? (
          <>
            <div className="folder-picker">
              <FolderOpen size={28} />
              <h3>One folder. Your whole project.</h3>
              <p>
                Grove discovers Git repositories in the selected folder. Service
                and setup commands are declared in your manifest.
              </p>
              <button
                className="button primary"
                onClick={() => void choose()}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <FolderOpen size={15} />
                )}
                {root ? "Choose another folder" : "Choose project folder"}
              </button>
              {root && <code>{root}</code>}
            </div>
            {report && (
              <>
                <label className="field">
                  Project name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <div className="repository-preview">
                  <h4>
                    Discovered repositories{" "}
                    <span className="heading-count">
                      {list(report.repositories).length}
                    </span>
                  </h4>
                  {list(report.repositories).map((repository, index) => (
                    <div key={repository.path || index}>
                      <FolderOpen size={15} />
                      <code>{repository.path}</code>
                    </div>
                  ))}
                  {!list(report.repositories).length && (
                    <p>
                      No repositories were found. Import a manifest or select
                      another folder.
                    </p>
                  )}
                </div>
                {list(report.unresolvedInputs).length > 0 && (
                  <div className="notice">
                    <AlertTriangle size={16} />
                    <span>{JSON.stringify(report.unresolvedInputs)}</span>
                  </div>
                )}
                <details className="discovery-evidence">
                  <summary>Discovery evidence</summary>
                  <pre className="json-output">
                    {JSON.stringify(report, null, 2)}
                  </pre>
                </details>
              </>
            )}
          </>
        ) : (
          <>
            {existing.loading && !manifest ? (
              <Loading label="Loading configuration…" />
            ) : (
              <>
                <div className="manifest-toolbar">
                  <span>
                    <FileJson2 size={16} />
                    worktree.project.json
                  </span>
                  <div>
                    <label className="button file-import">
                      <Upload size={14} />
                      Import JSON
                      <input
                        type="file"
                        accept=".json,application/json"
                        onChange={(event) =>
                          void importFile(event.target.files?.[0])
                        }
                        disabled={busy}
                      />
                    </label>
                    <button
                      className="button"
                      onClick={() => void exportManifest()}
                      disabled={busy || !manifest}
                    >
                      <ArrowDownToLine size={14} />
                      Export
                    </button>
                  </div>
                </div>
                <label className="sr-only" htmlFor="manifest-editor">
                  Project configuration JSON
                </label>
                <textarea
                  id="manifest-editor"
                  className="manifest-editor"
                  spellCheck={false}
                  value={manifest}
                  onChange={(event) => {
                    setManifest(event.target.value);
                    setValidation(undefined);
                  }}
                  disabled={busy}
                />
                <div className="manifest-validation">
                  <button
                    className="button"
                    disabled={busy || !manifest}
                    onClick={() => void validate()}
                  >
                    <ShieldCheck size={15} />
                    Validate configuration
                  </button>
                  {validation?.valid && (
                    <span className="validation-success">
                      <Check size={14} />
                      Schema valid
                    </span>
                  )}
                </div>
                {validation?.warnings?.length > 0 && (
                  <div className="notice">
                    <AlertTriangle size={16} />
                    <span>{validation?.warnings?.join("\n")}</span>
                  </div>
                )}
                <div className="form-note">
                  <FileJson2 size={17} />
                  <p>
                    Declare prerequisites, setup commands, service profiles,
                    resources, and entrypoints here. An agent can investigate
                    your project and generate this manifest; schema validation
                    does not verify that its commands run.
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </div>
      <div className="modal-footer">
        <button className="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        {step === "folder" ? (
          <button
            className="button primary"
            disabled={!root || busy}
            onClick={() => setStep("manifest")}
          >
            Review configuration
          </button>
        ) : (
          <button
            className="button primary"
            disabled={busy || !manifest || (!project && !root)}
            onClick={() => void save()}
          >
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Check size={15} />
            )}
            {busy
              ? "Saving…"
              : project
                ? "Save new revision"
                : "Register project"}
          </button>
        )}
      </div>
    </Modal>
  );
}
function ChevronStep() {
  return <span className="step-divider">/</span>;
}

export function DestroyDialog({
  workspace,
  run,
  onClose,
  onDestroyed,
}: {
  workspace: RecordData;
  run: RunAction;
  onClose: () => void;
  onDestroyed: () => void;
}) {
  const [version, setVersion] = useState(0);
  const preview = useQuery<RecordData>(
    "destroy.preview",
    { workspaceId: workspace.id },
    version,
  );
  const [discard, setDiscard] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dirty = list(preview.data?.targets).some((target) => target.dirty);
  const destroy = async () => {
    if (!preview.data) return;
    setBusy(true);
    setError(undefined);
    try {
      await run("destroy.execute", {
        previewId: preview.data.id,
        discardChanges: discard,
      });
      onDestroyed();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      wide
      title={`Destroy ${workspace.name}?`}
      subtitle="Review the controller’s exact removal scope before continuing."
      onClose={busy ? () => {} : onClose}
    >
      <div className="modal-body">
        <ErrorNotice message={error || preview.error} />
        {preview.loading ? (
          <Loading label="Building a fresh removal preview…" />
        ) : preview.data ? (
          <>
            <div className="notice warning">
              <AlertTriangle size={18} />
              <span>
                Owned services will stop and these worktrees will be removed.
                Local branches are retained.
              </span>
            </div>
            <div className="destroy-inventory">
              {list(preview.data.targets).map((target) => (
                <section key={target.checkoutId || target.path}>
                  <div>
                    <strong>{target.path}</strong>
                    <Badge state={target.dirty ? "degraded" : "clean"}>
                      {target.dirty ? "Local changes" : "No tracked changes"}
                    </Badge>
                  </div>
                  <p>
                    Retained branch{" "}
                    <code>{target.branch || "Not recorded"}</code>
                  </p>
                  <h4>Files in the removal scope</h4>
                  {Array.isArray(target.files) && target.files.length ? (
                    <ul className="inventory-files">
                      {target.files.map((file: any, index: number) => (
                        <li key={index}>
                          <code>
                            {typeof file === "string"
                              ? file
                              : file.path ||
                                file.relativePath ||
                                JSON.stringify(file)}
                          </code>
                          {typeof file === "object" && (
                            <small>
                              {file.kind || file.status || file.type || ""}
                              {file.ignored ? " · ignored" : ""}
                              {file.untracked ? " · untracked" : ""}
                            </small>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No files listed in this preview.</p>
                  )}
                  {target.services && (
                    <pre className="json-output">
                      {JSON.stringify(target.services, null, 2)}
                    </pre>
                  )}
                </section>
              ))}
            </div>
            {list(preview.data.resources).length > 0 && (
              <section className="repository-preview">
                <h4>Infrastructure in the removal scope</h4>
                {list(preview.data.resources).map((resource) => (
                  <div key={resource.id}>
                    <ShieldCheck size={15} />
                    <pre className="json-output">
                      {JSON.stringify(resource, null, 2)}
                    </pre>
                  </div>
                ))}
              </section>
            )}
            {list(preview.data.services).length > 0 && (
              <section className="repository-preview">
                <h4>Services that will stop</h4>
                <pre className="json-output">
                  {JSON.stringify(preview.data.services, null, 2)}
                </pre>
              </section>
            )}
            {preview.data.retainedBranches?.length > 0 && (
              <p className="retained-branches">
                Branches retained:{" "}
                <code>
                  {preview.data.retainedBranches
                    .map((item: any) =>
                      typeof item === "string" ? item : JSON.stringify(item),
                    )
                    .join(", ")}
                </code>
              </p>
            )}
            {preview.data.warnings?.map((warning: any, index: number) => (
              <div className="notice warning" key={index}>
                <AlertTriangle size={15} />
                <span>
                  {typeof warning === "string"
                    ? warning
                    : JSON.stringify(warning)}
                </span>
              </div>
            ))}
            <p className="muted small">
              Preview expires{" "}
              {preview.data.expiresAt
                ? new Date(preview.data.expiresAt).toLocaleString()
                : "when the controller’s scope changes"}
              . The controller rechecks files and ownership before removing
              anything.
            </p>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={scopeConfirmed}
                onChange={(event) => setScopeConfirmed(event.target.checked)}
                disabled={busy}
              />
              I confirm removal of the worktrees and runtime data shown above.
            </label>
            <label className="checkbox-field danger-checkbox">
              <input
                type="checkbox"
                checked={discard}
                onChange={(event) => setDiscard(event.target.checked)}
                disabled={busy}
              />
              Discard uncommitted work, including tracked and untracked changes.
            </label>
            {dirty && !discard && (
              <p className="inline-warning">
                This preview contains local changes. Discard must be explicitly
                selected to remove them.
              </p>
            )}
            <label className="field">
              Type <strong>{workspace.name}</strong> to confirm
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                disabled={busy}
              />
            </label>
          </>
        ) : (
          <Empty
            title="Preview unavailable"
            text="No removal can proceed without a current controller preview."
          />
        )}
      </div>
      <div className="modal-footer">
        <button className="button" disabled={busy} onClick={onClose}>
          Keep workspace
        </button>
        <button
          className="button"
          disabled={busy || preview.loading}
          onClick={() => {
            setVersion((value) => value + 1);
            setScopeConfirmed(false);
            setDiscard(false);
            setConfirmation("");
          }}
        >
          Refresh preview
        </button>
        <button
          className="button danger"
          disabled={
            busy ||
            !preview.data ||
            preview.loading ||
            !!preview.error ||
            !scopeConfirmed ||
            confirmation !== workspace.name ||
            (dirty && !discard)
          }
          onClick={() => void destroy()}
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
          {busy ? "Removing…" : "Destroy workspace"}
        </button>
      </div>
    </Modal>
  );
}
