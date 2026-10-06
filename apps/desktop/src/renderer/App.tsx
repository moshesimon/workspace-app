import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Folder,
  FolderGit2,
  GitBranch,
  Layers3,
  Leaf,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  dateLabel,
  errorMessage,
  isLive,
  list,
  mutate,
  query,
  useQuery,
  type Operation,
  type RecordData,
} from "./api.js";
import {
  Badge,
  Empty,
  ErrorNotice,
  Loading,
  SnapshotTime,
} from "./components.js";
import { CreateWorkspace, DestroyDialog, ProjectDialog } from "./dialogs.js";
import { WorkspaceDetail } from "./detail.js";
import { SettingsView } from "./settings.js";

type Page = "workspaces" | "projects" | "activity" | "settings";
export type RunAction = (
  name: string,
  input: Record<string, unknown>,
) => Promise<any>;
export default function App() {
  const [page, setPage] = useState<Page>("workspaces");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<"project" | "workspace" | null>(null);
  const [editingProject, setEditingProject] = useState<RecordData | null>(null);
  const [destroying, setDestroying] = useState<RecordData | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [operations, setOperations] = useState<Operation[]>([]);
  const [error, setError] = useState<string>();
  const projects = useQuery<RecordData[]>("projects.list", {}, version);
  const workspaces = useQuery<RecordData[]>("workspaces.list", {}, version);
  const status = useQuery<RecordData>("controller.status", {}, version);
  const updateOperation = useCallback(
    (operation: Operation) =>
      setOperations((previous) => [
        operation,
        ...previous.filter((item) => item.id !== operation.id),
      ]),
    [],
  );
  const run = useCallback<RunAction>(
    async (name, input) => {
      const scope = String(
        input.workspaceId || input.projectId || input.previewId || name,
      );
      setBusy((previous) => ({ ...previous, [scope]: true }));
      setError(undefined);
      try {
        const result = await mutate(name, input, updateOperation);
        return result;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      } finally {
        setBusy((previous) => ({ ...previous, [scope]: false }));
        setVersion((value) => value + 1);
      }
    },
    [updateOperation],
  );
  const refresh = () => setVersion((value) => value + 1);
  const safeRun = (name: string, input: Record<string, unknown>) => {
    void run(name, input).catch(() => {});
  };
  const openUrl = useCallback((url: string) => {
    if (!window.worktree) return;
    void window.worktree
      .openExternal(url)
      .catch((cause) => setError(errorMessage(cause)));
  }, []);
  const visibleWorkspaces = useMemo(
    () =>
      list(workspaces.data).filter(
        (workspace) =>
          (projectFilter === "all" || workspace.projectId === projectFilter) &&
          (statusFilter === "all" ||
            (statusFilter === "running"
              ? isLive(workspace.state)
              : !isLive(workspace.state))) &&
          `${workspace.name} ${workspace.projectName} ${list(
            workspace.checkouts,
          )
            .map((checkout) => checkout.currentBranch)
            .join(" ")}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [workspaces.data, projectFilter, search, statusFilter],
  );
  const activeOperations = operations.filter(
    (item) => item.status === "running" || item.status === "queued",
  );
  const go = (next: Page) => {
    setPage(next);
    setSelected(null);
    setSearch("");
  };
  const selectedWorkspace = list(workspaces.data).find(
    (item) => item.id === selected,
  );
  const projectName =
    projectFilter === "all"
      ? "All projects"
      : list(projects.data).find((item) => item.id === projectFilter)?.name ||
        "Project";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Leaf size={22} strokeWidth={2.3} />
          </div>
          <div>
            grove<span>YOUR LOCAL WORKSPACE</span>
          </div>
        </div>
        <div className="sidebar-caption">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(
            [
              { key: "workspaces", label: "Workspaces", icon: Layers3 },
              { key: "projects", label: "Projects", icon: FolderGit2 },
              { key: "activity", label: "Activity", icon: Activity },
            ] as const
          ).map((item) => (
            <button
              className={`nav-item ${page === item.key ? "active" : ""}`}
              key={item.key}
              onClick={() => go(item.key)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.key === "activity" && activeOperations.length > 0 && (
                <small>{activeOperations.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-project-heading">
          <span className="sidebar-caption">PROJECTS</span>
          <button
            className="icon-button"
            title="Add project"
            aria-label="Add project"
            onClick={() => setModal("project")}
          >
            <Plus size={16} />
          </button>
        </div>
        <button
          className={`project-filter ${projectFilter === "all" && page === "workspaces" ? "active" : ""}`}
          onClick={() => {
            go("workspaces");
            setProjectFilter("all");
          }}
        >
          <span className="project-color all" />
          All projects<span>{list(projects.data).length}</span>
        </button>
        {list(projects.data).map((project, index) => (
          <button
            className={`project-filter ${projectFilter === project.id && page === "workspaces" ? "active" : ""}`}
            key={project.id}
            onClick={() => {
              go("workspaces");
              setProjectFilter(project.id);
            }}
          >
            <span className={`project-color color-${index % 4}`} />
            <span className="truncate">{project.name}</span>
          </button>
        ))}
        {!projects.loading && !list(projects.data).length && (
          <p className="sidebar-hint">
            Add a project folder to bring your repositories together.
          </p>
        )}
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            onClick={() => go("settings")}
          >
            <Settings2 size={18} />
            Settings
          </button>
          <div className="controller-indicator">
            <span
              className={`status-dot ${status.data && !status.error ? "live" : ""}`}
            />
            <span>
              {status.loading
                ? "Connecting to controller"
                : status.error
                  ? "Controller unavailable"
                  : "Local controller connected"}
            </span>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <div className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {selected
                ? selectedWorkspace?.name || "Workspace detail"
                : page === "workspaces"
                  ? projectName
                  : page[0].toUpperCase() + page.slice(1)}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="local-label">
              <span className="status-dot live" />
              Local only
            </span>
            <button
              className="icon-button"
              title="Reload controller data"
              aria-label="Reload controller data"
              onClick={refresh}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
        <div className="page-content">
          <ErrorNotice message={error} />
          {activeOperations.length > 0 && (
            <div className="operation-banner" role="status">
              <Loader2 size={16} className="spin" />
              <span>
                {activeOperations[0].action.replaceAll(".", " · ")} in progress
              </span>
              <button className="text-button" onClick={() => go("activity")}>
                View activity
                <ArrowUpRight size={13} />
              </button>
            </div>
          )}
          {selected ? (
            <>
              <button className="back-link" onClick={() => setSelected(null)}>
                <ArrowLeft size={15} />
                All workspaces
              </button>
              <WorkspaceDetail
                workspaceId={selected}
                version={version}
                run={run}
                busy={!!busy[selected]}
                openUrl={openUrl}
                onDestroy={(workspace) => setDestroying(workspace)}
              />
            </>
          ) : page === "workspaces" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">A LITTLE ROOM TO BUILD</div>
                  <h1>
                    Workspaces
                    <span className="heading-count">
                      {visibleWorkspaces.length}
                    </span>
                  </h1>
                  <p>
                    Independent branches. Connected services. Everything in its
                    place.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() =>
                    setModal(
                      list(projects.data).length ? "workspace" : "project",
                    )
                  }
                >
                  <Plus size={16} />
                  New workspace
                </button>
              </div>
              <div className="toolbar">
                <div
                  className="filter-tabs"
                  aria-label="Filter workspace status"
                >
                  {[
                    ["all", "All workspaces"],
                    ["running", "Running"],
                    ["stopped", "Not running"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={statusFilter === value ? "active" : ""}
                      onClick={() => setStatusFilter(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search workspaces"
                    placeholder="Search workspaces…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  {search && (
                    <button
                      className="icon-button"
                      aria-label="Clear search"
                      onClick={() => setSearch("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </label>
              </div>
              <ErrorNotice
                message={workspaces.error}
                stale={!!workspaces.data}
              />
              <ErrorNotice
                message={
                  projects.error !== workspaces.error
                    ? projects.error
                    : undefined
                }
              />
              {workspaces.loading && !workspaces.data ? (
                <Loading label="Finding your workspaces…" />
              ) : visibleWorkspaces.length ? (
                <div className="workspace-grid">
                  {visibleWorkspaces.map((workspace) => (
                    <WorkspaceCard
                      key={workspace.id}
                      workspace={workspace}
                      busy={!!busy[workspace.id]}
                      version={version}
                      onOpen={() => setSelected(workspace.id)}
                      onAction={(action) =>
                        safeRun(`lifecycle.${action}`, {
                          workspaceId: workspace.id,
                        })
                      }
                      onDestroy={() => setDestroying(workspace)}
                      openUrl={openUrl}
                    />
                  ))}
                </div>
              ) : (
                <div className="welcome-panel">
                  <Empty
                    icon={<FolderGit2 size={31} />}
                    title={
                      search || statusFilter !== "all"
                        ? "No workspaces match"
                        : "Make space for your next idea"
                    }
                    text={
                      search || statusFilter !== "all"
                        ? "Try another search or workspace filter."
                        : "Bring a project folder into Grove, then create an isolated workspace for each branch of work."
                    }
                    action={
                      !(search || statusFilter !== "all") && (
                        <button
                          className="button primary"
                          onClick={() =>
                            setModal(
                              list(projects.data).length
                                ? "workspace"
                                : "project",
                            )
                          }
                        >
                          <Plus size={16} />
                          {list(projects.data).length
                            ? "Create a workspace"
                            : "Add your first project"}
                        </button>
                      )
                    }
                  />
                  <div className="welcome-steps">
                    <div>
                      <span>01</span>
                      <FolderGit2 size={20} />
                      <h4>Bring your repositories</h4>
                      <p>
                        Choose a folder with one repository or a whole project.
                      </p>
                    </div>
                    <div>
                      <span>02</span>
                      <GitBranch size={20} />
                      <h4>Give your work a branch</h4>
                      <p>
                        Create a workspace with its own checkout and recorded
                        origin.
                      </p>
                    </div>
                    <div>
                      <span>03</span>
                      <Play size={20} />
                      <h4>Start your stack</h4>
                      <p>
                        Your configuration connects services and keeps ports
                        separate.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              <div className="page-footnote">
                <Folder size={14} />
                <span>
                  Worktrees share Git history. Your working files and configured
                  runtime stay separate.
                </span>
                <SnapshotTime value={workspaces.updatedAt} />
              </div>
            </>
          ) : page === "projects" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR FOUNDATIONS</div>
                  <h1>Projects</h1>
                  <p>
                    A folder, its repositories, and a repeatable way to run
                    them.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setModal("project")}
                >
                  <Plus size={16} />
                  Add project
                </button>
              </div>
              <ErrorNotice message={projects.error} />
              {projects.loading ? (
                <Loading />
              ) : list(projects.data).length ? (
                <div className="project-grid">
                  {list(projects.data).map((project) => (
                    <article className="project-card" key={project.id}>
                      <div className="card-icon">
                        <FolderGit2 size={23} />
                      </div>
                      <h3>{project.name}</h3>
                      <p className="mono path-text">{project.root}</p>
                      <div className="project-card-footer">
                        <span>Registered {dateLabel(project.createdAt)}</span>
                        <button
                          className="button"
                          onClick={() => setEditingProject(project)}
                        >
                          Configuration
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  title="Your projects start here"
                  text="Choose a local project folder. Grove will inventory its repositories before you register it."
                  action={
                    <button
                      className="button primary"
                      onClick={() => setModal("project")}
                    >
                      <Plus size={15} />
                      Add project
                    </button>
                  }
                />
              )}
            </>
          ) : page === "activity" ? (
            <ActivityView operations={operations} version={version} />
          ) : (
            <SettingsView version={version} run={run} status={status.data} />
          )}
        </div>
      </main>
      {modal === "workspace" && (
        <CreateWorkspace
          projects={list(projects.data)}
          initialProject={projectFilter === "all" ? undefined : projectFilter}
          run={run}
          onClose={() => setModal(null)}
          onCreated={(workspace) => {
            setModal(null);
            if (workspace?.id) setSelected(workspace.id);
            setPage("workspaces");
          }}
        />
      )}
      {(modal === "project" || editingProject) && (
        <ProjectDialog
          project={editingProject || undefined}
          version={version}
          run={run}
          onClose={() => {
            setModal(null);
            setEditingProject(null);
          }}
          onSaved={() => {
            setModal(null);
            setEditingProject(null);
            refresh();
          }}
        />
      )}
      {destroying && (
        <DestroyDialog
          workspace={destroying}
          run={run}
          onClose={() => setDestroying(null)}
          onDestroyed={() => {
            setDestroying(null);
            setSelected(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function WorkspaceCard({
  workspace,
  busy,
  version,
  onOpen,
  onAction,
  onDestroy,
  openUrl,
}: {
  workspace: RecordData;
  busy: boolean;
  version: number;
  onOpen: () => void;
  onAction: (action: string) => void;
  onDestroy: () => void;
  openUrl: (url: string) => void;
}) {
  const services = list(workspace.services);
  const snapshot = useQuery<RecordData>(
    workspace.entrypoints ? null : "workspaces.get",
    { workspaceId: workspace.id },
    version,
  );
  const manifest = snapshot.data?.configuration?.manifest;
  const noRuntime = manifest
    ? !list(manifest.services).length && !list(manifest.resources).length
    : workspace.hasRuntime === false;
  const state = noRuntime ? "no services" : workspace.state;
  const entrypoints: RecordData[] = workspace.entrypoints
    ? list(workspace.entrypoints)
    : list(manifest?.entrypoints).map((entrypoint) => {
        const service = services.find(
          (service) =>
            entrypoint.service === service.logicalId ||
            entrypoint.service ===
              `${service.repositoryKey}/${service.logicalId}`,
        );
        return {
          ...entrypoint,
          label: entrypoint.label,
          url: service && isLive(service.state) ? service.url : undefined,
        };
      });
  const openable = entrypoints.filter((entrypoint) => entrypoint.url);
  return (
    <article className={`workspace-card ${busy ? "is-busy" : ""}`}>
      <div className="workspace-card-head">
        <div className="card-icon">
          <FolderGit2 size={22} />
        </div>
        <button className="workspace-title" onClick={onOpen}>
          {workspace.name}
        </button>
        <Badge state={state} />
      </div>
      <div className="card-meta">
        {workspace.projectName && (
          <span>
            {workspace.projectName}
            <span className="separator">·</span>
          </span>
        )}
        Created {dateLabel(workspace.createdAt)}
        <span className="separator">·</span>
        {list(workspace.checkouts).length} checkouts
      </div>
      <div className="checkout-list">
        {list(workspace.checkouts).map((checkout) => (
          <CheckoutSummary
            checkout={checkout}
            key={checkout.id}
            version={version}
            onOpen={onOpen}
            openUrl={openUrl}
          />
        ))}
      </div>
      {services.length > 0 && (
        <div className="port-chips">
          {services.map((service) => (
            <button
              disabled={
                !service.url || !isLive(service.state || service.status)
              }
              title={`Preferred: ${service.preferredPort ?? "none"} · Assigned: ${service.assignedPort ?? service.port ?? "none"} · Observed: ${service.observedPorts?.join(", ") || service.observedPort || "unknown"}`}
              className="port-chip"
              key={service.id}
              onClick={() => service.url && openUrl(service.url)}
            >
              <span
                className={`status-dot ${isLive(service.state || service.status) ? "live" : ""}`}
              />
              {service.name ||
                service.serviceKey ||
                service.definitionId ||
                service.logicalId ||
                service.id}
              <code>
                {service.observedPorts?.[0] ??
                  service.observedPort ??
                  service.assignedPort ??
                  service.port ??
                  ""}
              </code>
              {service.url && <ArrowUpRight size={13} />}
            </button>
          ))}
        </div>
      )}
      <div className="card-actions">
        <button
          disabled={busy}
          onClick={() => onAction("start")}
          title="Start workspace"
        >
          <Play size={14} />
          Start
        </button>
        <button
          disabled={busy}
          onClick={() => onAction("stop")}
          title="Stop workspace"
        >
          <Square size={13} />
          Stop
        </button>
        <button
          disabled={busy}
          onClick={() => onAction("refresh")}
          title="Refresh workspace"
        >
          <RefreshCw size={14} />
        </button>
        <button
          disabled={busy}
          onClick={onDestroy}
          className="destroy-action"
          title="Preview workspace destruction"
          aria-label={`Destroy ${workspace.name}`}
        >
          <Trash2 size={14} />
        </button>
        <div className="card-actions-spacer" />
        {openable.length === 1 ? (
          <button className="open-app" onClick={() => openUrl(openable[0].url)}>
            Open app
            <ArrowUpRight size={14} />
          </button>
        ) : openable.length > 1 ? (
          <select
            className="entrypoint-select"
            aria-label="Open workspace entrypoint"
            value=""
            onChange={(event) => {
              if (event.target.value) openUrl(event.target.value);
            }}
          >
            <option value="">Open app ↗</option>
            {openable.map((item) => (
              <option key={`${item.label}:${item.url}`} value={item.url}>
                {item.label}
              </option>
            ))}
          </select>
        ) : (
          <button className="open-app" onClick={onOpen}>
            Inspect
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    </article>
  );
}
function CheckoutSummary({
  checkout,
  version,
  onOpen,
  openUrl,
}: {
  checkout: RecordData;
  version: number;
  onOpen: () => void;
  openUrl: (url: string) => void;
}) {
  const changes = useQuery<RecordData>(
    "changes.list",
    { checkoutId: checkout.id },
    version,
  );
  const history = useQuery<RecordData>(
    "history.list",
    { checkoutId: checkout.id, limit: 1 },
    version,
  );
  const prs = useQuery<RecordData>(
    "pullRequests.list",
    { checkoutId: checkout.id },
    version,
  );
  return (
    <section className="checkout-summary">
      <div className="checkout-title-row">
        <button className="text-title" onClick={onOpen}>
          {checkout.repositoryKey}
        </button>
        <div className="git-summary">
          {changes.data && !changes.error ? (
            <span className="pill">
              {changes.data.clean ? (
                <>
                  <Check size={12} />
                  Clean
                </>
              ) : (
                `${list(changes.data.files).length} files changed`
              )}
            </span>
          ) : (
            <span className="pill">
              {changes.loading ? "Checking…" : "Status unavailable"}
            </span>
          )}
          {history.data?.commitsSinceBase != null && (
            <span className="pill" title="Commits since recorded base">
              <GitBranch size={12} />
              {history.data.commitsSinceBase} commits
            </span>
          )}
        </div>
      </div>
      <div className="branch-row">
        <span>Branch</span>
        <code>{checkout.currentBranch || "Detached HEAD"}</code>
      </div>
      <div className="branch-row">
        <span>From</span>
        <code>{checkout.sourceRef || "Origin unknown"}</code>
        {checkout.originEvidence && checkout.originEvidence !== "recorded" && (
          <small className="evidence">{checkout.originEvidence}</small>
        )}
      </div>
      {checkout.createdBranch &&
        checkout.createdBranch !== checkout.currentBranch && (
          <div className="origin-note">
            Created as <code>{checkout.createdBranch}</code>
          </div>
        )}
      {checkout.sourceCommit && (
        <div className="origin-note" title={checkout.sourceCommit}>
          Recorded base <code>{checkout.sourceCommit.slice(0, 8)}</code>
        </div>
      )}
      {changes.error && (
        <div className="inline-warning">Git status unavailable</div>
      )}
      {prs.loading ? (
        <p className="pr-empty">Checking pull requests…</p>
      ) : prs.error || prs.data?.status === "unavailable" ? (
        <p
          className="pr-empty warning"
          title={prs.error || prs.data?.error?.message || prs.data?.error}
        >
          Pull requests unavailable
        </p>
      ) : list(prs.data?.pullRequests).length ? (
        <div className="card-prs">
          {list(prs.data?.pullRequests).map((pr) => (
            <button
              className="pr-summary"
              key={`${pr.repository}:${pr.number}`}
              onClick={onOpen}
            >
              <Badge
                state={pr.isDraft ? "draft" : String(pr.state).toLowerCase()}
              />
              <strong>
                #{pr.number} {pr.title}
              </strong>
              <ChevronRight size={14} />
              <span>
                → {pr.baseRefName}
                {pr.reviewDecision
                  ? ` · ${pr.reviewDecision.toLowerCase().replaceAll("_", " ")}`
                  : ""}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="pr-empty">No matching pull request</p>
      )}
    </section>
  );
}
function ActivityView({
  operations,
  version,
}: {
  operations: Operation[];
  version: number;
}) {
  const [poll, setPoll] = useState(0);
  const persisted = useQuery<Operation[]>(
    "operations.list",
    {},
    version + poll,
  );
  useEffect(() => {
    if (
      !list(persisted.data).some((operation) =>
        ["running", "queued"].includes(operation.status),
      )
    )
      return;
    const timer = setTimeout(() => setPoll((value) => value + 1), 1200);
    return () => clearTimeout(timer);
  }, [persisted.data]);
  const entries = [
    ...operations,
    ...list(persisted.data).filter(
      (item) => !operations.some((operation) => operation.id === item.id),
    ),
  ] as Operation[];
  const [selected, setSelected] = useState<string>();
  const item = entries.find((entry) => entry.id === selected);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE WORK BEHIND YOUR WORK</div>
          <h1>Activity</h1>
          <p>Lifecycle progress and outcomes from your local controller.</p>
        </div>
      </div>
      <ErrorNotice message={persisted.error} stale={!!entries.length} />
      {!entries.length ? (
        <Empty
          icon={<Clock3 size={26} />}
          title="A quiet workspace"
          text="Operations will appear here when you create, prepare, start, stop, refresh, or remove a workspace."
        />
      ) : (
        <div className="activity-layout">
          <div className="activity-list">
            {entries.map((operation) => (
              <button
                className={`activity-row ${selected === operation.id ? "selected" : ""}`}
                key={operation.id}
                onClick={() => setSelected(operation.id)}
              >
                <div className="activity-icon">
                  {operation.status === "running" ||
                  operation.status === "queued" ? (
                    <Loader2 size={18} className="spin" />
                  ) : (
                    <Activity size={18} />
                  )}
                </div>
                <div>
                  <strong>{operation.action}</strong>
                  <small>
                    {dateLabel(operation.updatedAt || operation.createdAt)}
                  </small>
                </div>
                <Badge state={operation.status} />
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
          {item && (
            <div className="activity-detail">
              <h3>{item.action}</h3>
              <code className="muted">{item.id}</code>
              <ErrorNotice message={item.error?.message} />
              <h4>Outcome</h4>
              <pre className="json-output">
                {JSON.stringify(item.result ?? item.outcomes ?? {}, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </>
  );
}
