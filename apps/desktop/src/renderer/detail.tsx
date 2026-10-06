import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Loader2,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  dateLabel,
  errorMessage,
  isLive,
  list,
  query,
  useQuery,
  type RecordData,
} from "./api.js";
import {
  Badge,
  Diff,
  Empty,
  ErrorNotice,
  FileTree,
  Loading,
  SnapshotTime,
  type FileSelection,
} from "./components.js";
import type { RunAction } from "./App.js";

type Tab = "changes" | "history" | "pullRequests" | "services" | "setup";
export function WorkspaceDetail({
  workspaceId,
  version,
  run,
  busy,
  openUrl,
  onDestroy,
}: {
  workspaceId: string;
  version: number;
  run: RunAction;
  busy: boolean;
  openUrl: (url: string) => void;
  onDestroy: (workspace: RecordData) => void;
}) {
  const detail = useQuery<RecordData>(
    "workspaces.get",
    { workspaceId },
    version,
  );
  const [tab, setTab] = useState<Tab>("changes");
  const [checkoutId, setCheckoutId] = useState("");
  const [error, setError] = useState<string>();
  const checkouts = list(detail.data?.checkouts);
  useEffect(() => {
    if (
      checkouts.length &&
      !checkouts.some((checkout) => checkout.id === checkoutId)
    )
      setCheckoutId(checkouts[0].id);
  }, [detail.data, checkoutId]);
  const action = async (name: string, input: Record<string, unknown> = {}) => {
    setError(undefined);
    try {
      await run(name, { workspaceId, ...input });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  if (detail.loading && !detail.data)
    return <Loading label="Opening workspace…" />;
  if (!detail.data)
    return <ErrorNotice message={detail.error || "Workspace unavailable"} />;
  const workspace = detail.data.workspace;
  const selectedCheckout = checkouts.find(
    (checkout) => checkout.id === checkoutId,
  );
  return (
    <>
      <div className="detail-heading">
        <div className="workspace-heading">
          <div className="card-icon">
            <FolderWorkspace />
          </div>
          <div>
            <div className="eyebrow">
              {detail.data.project?.name || "WORKSPACE"}
            </div>
            <h1>
              {workspace.name}
              <Badge state={workspace.state} />
            </h1>
            <p>
              Created {dateLabel(workspace.createdAt)} · {checkouts.length}{" "}
              checkouts
            </p>
          </div>
        </div>
        <div className="action-group">
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void action("lifecycle.start")}
          >
            <Play size={14} />
            Start
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => void action("lifecycle.stop")}
          >
            <Square size={13} />
            Stop
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => void action("lifecycle.refresh")}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            className="button danger-subtle"
            disabled={busy}
            onClick={() => onDestroy(workspace)}
          >
            <Trash2 size={14} />
            Destroy
          </button>
        </div>
      </div>
      <ErrorNotice
        message={detail.error || error}
        stale={!!detail.error && !!detail.data}
      />
      {detail.data.configurationDrift && (
        <div className="notice warning">
          <ShieldCheck size={17} />
          <span>
            A newer project configuration is available. This workspace still
            uses its pinned revision.
          </span>
        </div>
      )}
      <nav className="detail-tabs" aria-label="Workspace views">
        {(
          [
            { key: "changes", title: "Changes", icon: FileCode2 },
            { key: "history", title: "History", icon: GitCommitHorizontal },
            {
              key: "pullRequests",
              title: "Pull requests",
              icon: GitPullRequest,
            },
            { key: "services", title: "Services", icon: Server },
            { key: "setup", title: "Setup", icon: Terminal },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            className={tab === item.key ? "active" : ""}
            onClick={() => setTab(item.key)}
            aria-current={tab === item.key ? "page" : undefined}
          >
            <item.icon size={17} />
            {item.title}
          </button>
        ))}
      </nav>
      {(tab === "history" || tab === "pullRequests") && (
        <div className="checkout-selector">
          <label htmlFor="checkout-select">Repository</label>
          <select
            id="checkout-select"
            value={checkoutId}
            onChange={(event) => setCheckoutId(event.target.value)}
          >
            {checkouts.map((checkout) => (
              <option key={checkout.id} value={checkout.id}>
                {checkout.repositoryKey}
              </option>
            ))}
          </select>
          {selectedCheckout && (
            <span>
              <GitBranch size={14} />
              <code>{selectedCheckout.currentBranch || "Detached HEAD"}</code>
            </span>
          )}
        </div>
      )}
      {tab === "changes" && (
        <ChangesView checkouts={checkouts} version={version} />
      )}
      {tab === "history" &&
        (checkoutId ? (
          <HistoryView checkout={selectedCheckout!} version={version} />
        ) : (
          <Empty
            title="No checkout history"
            text="This workspace has no linked checkout to inspect."
          />
        ))}
      {tab === "pullRequests" &&
        (checkoutId ? (
          <PullRequestsView
            checkoutId={checkoutId}
            version={version}
            openUrl={openUrl}
          />
        ) : (
          <Empty
            title="No checkout selected"
            text="Pull requests are matched to each checkout’s repository and branch."
          />
        ))}
      {tab === "services" && (
        <ServicesView
          detail={detail.data}
          version={version}
          busy={busy}
          action={action}
          openUrl={openUrl}
        />
      )}
      {tab === "setup" && (
        <SetupView
          detail={detail.data}
          version={version}
          busy={busy}
          action={action}
        />
      )}
      <div className="detail-footnote">
        <SnapshotTime value={detail.updatedAt} />
        <code>{workspace.id}</code>
      </div>
    </>
  );
}
function FolderWorkspace() {
  return <GitBranch size={23} />;
}
function ChangesView({
  checkouts,
  version,
}: {
  checkouts: RecordData[];
  version: number;
}) {
  const [snapshots, setSnapshots] = useState<Record<string, any>>({});
  const [selected, setSelected] = useState<FileSelection>();
  const [loading, setLoading] = useState(false);
  const key = checkouts.map((checkout) => checkout.id).join(",");
  useEffect(() => {
    let current = true;
    setLoading(true);
    Promise.all(
      checkouts.map(async (checkout) => {
        try {
          return [
            checkout.id,
            await query("changes.list", { checkoutId: checkout.id }),
          ] as const;
        } catch (cause) {
          return [checkout.id, { error: errorMessage(cause) }] as const;
        }
      }),
    ).then((entries) => {
      if (current) {
        setSnapshots(Object.fromEntries(entries));
        setLoading(false);
      }
    });
    return () => {
      current = false;
    };
  }, [key, version]);
  const diff = useQuery<RecordData>(
    selected ? "changes.diff" : null,
    selected ? { ...selected } : {},
    version,
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Local changes</h2>
          <p>
            Working files compared with HEAD, including staged and untracked
            files.
          </p>
        </div>
        {loading && <Loader2 size={16} className="spin" />}
      </div>
      {!checkouts.length ? (
        <Empty
          title="No checkouts to inspect"
          text="Create or attach a checkout to see its local files."
        />
      ) : (
        <div className="inspection-panel">
          <FileTree
            checkouts={checkouts}
            snapshots={snapshots}
            selected={selected}
            onSelect={setSelected}
          />
          <div className="diff-container">
            <ErrorNotice message={diff.error} stale={!!diff.data} />
            {diff.loading ? (
              <Loading label="Reading file changes…" />
            ) : (
              <Diff
                data={diff.data}
                title={
                  selected ? `${selected.path} · ${selected.area}` : undefined
                }
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
function HistoryView({
  checkout,
  version,
}: {
  checkout: RecordData;
  version: number;
}) {
  const [offset, setOffset] = useState(0);
  const [commit, setCommit] = useState("");
  const history = useQuery<RecordData>(
    "history.list",
    { checkoutId: checkout.id, limit: 50, offset },
    version,
  );
  const diff = useQuery<RecordData>(
    commit ? "history.commit" : null,
    { checkoutId: checkout.id, commit },
    version,
  );
  useEffect(() => {
    setCommit("");
    setOffset(0);
  }, [checkout.id]);
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Commit history</h2>
          <p>
            {checkout.sourceCommit && history.data?.commitsSinceBase != null
              ? `${history.data.commitsSinceBase} commits since recorded base ${checkout.sourceCommit.slice(0, 8)}`
              : "History is available. A recorded source commit is required to count commits since the original base."}
          </p>
        </div>
      </div>
      <ErrorNotice message={history.error} stale={!!history.data} />
      {history.loading && !history.data ? (
        <Loading />
      ) : !list(history.data?.commits).length ? (
        <Empty
          icon={<GitCommitHorizontal size={25} />}
          title="No commits to show"
          text="This checkout’s history is empty or currently unavailable."
        />
      ) : (
        <div className="inspection-panel">
          <div className="history-list">
            {list(history.data?.commits).map((item) => (
              <button
                className={`commit-row ${commit === item.hash ? "selected" : ""}`}
                key={item.hash}
                onClick={() => setCommit(item.hash)}
              >
                <GitCommitHorizontal size={16} />
                <div>
                  <strong>{item.subject}</strong>
                  <span>
                    {item.author} · {dateLabel(item.date)}
                  </span>
                  <code>{item.hash.slice(0, 8)}</code>
                </div>
              </button>
            ))}
            {offset > 0 && (
              <button
                className="button load-more"
                onClick={() => setOffset((value) => Math.max(0, value - 50))}
                disabled={history.loading}
              >
                Previous commits
              </button>
            )}
            {list(history.data?.commits).length >= 50 && (
              <button
                className="button load-more"
                onClick={() => setOffset((value) => value + 50)}
                disabled={history.loading}
              >
                Next 50 commits
              </button>
            )}
          </div>
          <div className="diff-container">
            <ErrorNotice message={diff.error} />
            {diff.loading ? (
              <Loading label="Reading commit diff…" />
            ) : (
              <Diff
                data={diff.data}
                title={commit ? `Commit ${commit.slice(0, 8)}` : undefined}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
function PullRequestsView({
  checkoutId,
  version,
  openUrl,
}: {
  checkoutId: string;
  version: number;
  openUrl: (url: string) => void;
}) {
  const [number, setNumber] = useState<number>();
  const [repository, setRepository] = useState<string>();
  const prs = useQuery<RecordData>(
    "pullRequests.list",
    { checkoutId },
    version,
  );
  const detail = useQuery<RecordData>(
    number ? "pullRequests.get" : null,
    { checkoutId, number, ...(repository ? { repository } : {}) },
    version,
  );
  const diff = useQuery<RecordData>(
    number ? "pullRequests.diff" : null,
    { checkoutId, number, ...(repository ? { repository } : {}) },
    version,
  );
  useEffect(() => {
    setNumber(undefined);
    setRepository(undefined);
  }, [checkoutId]);
  const selected = list(prs.data?.pullRequests).find(
    (pr) =>
      pr.number === number && (!repository || pr.repository === repository),
  );
  const unavailable = prs.error || prs.data?.status === "unavailable";
  const fetchError =
    typeof prs.data?.error === "string"
      ? prs.data.error
      : prs.data?.error?.message;
  const mismatch = !!(
    detail.data &&
    diff.data &&
    ((diff.data.headRefOid &&
      diff.data.headRefOid !== detail.data.headRefOid) ||
      (diff.data.baseRefOid && diff.data.baseRefOid !== detail.data.baseRefOid))
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Pull requests</h2>
          <p>
            Remote PR changes, separate from the working tree. Matched by
            repository and branch.
          </p>
        </div>
        <SnapshotTime
          value={prs.data?.refreshedAt || prs.data?.fetchedAt || prs.updatedAt}
        />
      </div>
      {unavailable ? (
        <>
          <ErrorNotice
            message={
              prs.error ||
              fetchError ||
              prs.data?.message ||
              "GitHub CLI data is unavailable. Check gh installation, authentication, and network access."
            }
          />
          <Empty
            icon={<GitPullRequest size={25} />}
            title="Pull requests unavailable"
            text="Local changes and commit history remain available."
          />
        </>
      ) : prs.loading && !prs.data ? (
        <Loading label="Finding matching pull requests…" />
      ) : !list(prs.data?.pullRequests).length ? (
        <Empty
          icon={<GitPullRequest size={25} />}
          title="No matching pull request"
          text="No pull requests match this checkout’s repository and current branch."
        />
      ) : (
        <div className="pr-layout">
          <div className="pr-list">
            {list(prs.data?.pullRequests).map((pr) => (
              <button
                className={`pr-row ${number === pr.number && repository === pr.repository ? "selected" : ""}`}
                key={`${pr.repository}:${pr.number}`}
                onClick={() => {
                  setNumber(pr.number);
                  setRepository(pr.repository);
                }}
              >
                <Badge
                  state={pr.isDraft ? "draft" : String(pr.state).toLowerCase()}
                />
                <strong>
                  #{pr.number} {pr.title}
                </strong>
                <span>
                  {pr.headRefName} → {pr.baseRefName}
                </span>
                {pr.reviewDecision && (
                  <small>{pr.reviewDecision.replaceAll("_", " ")}</small>
                )}
              </button>
            ))}
          </div>
          <div className="pr-detail">
            {!number ? (
              <Empty
                icon={<GitPullRequest size={24} />}
                title="Choose a pull request"
                text="Inspect its commits and changed-file diff here."
              />
            ) : (
              <>
                <div className="pr-detail-heading">
                  <h3>{selected?.title || `Pull request #${number}`}</h3>
                  {selected?.url && (
                    <button
                      className="button"
                      onClick={() => openUrl(selected.url)}
                    >
                      GitHub
                      <ArrowUpRight size={14} />
                    </button>
                  )}
                </div>
                <ErrorNotice
                  message={
                    detail.error ||
                    diff.error ||
                    (detail.data?.status === "unavailable"
                      ? detail.data.message
                      : undefined) ||
                    (diff.data?.status === "unavailable"
                      ? diff.data.message
                      : undefined) ||
                    (mismatch
                      ? "The PR changed during retrieval. Refresh before viewing a mixed snapshot."
                      : undefined)
                  }
                />
                {detail.loading || diff.loading ? (
                  <Loading label="Reading pull request snapshot…" />
                ) : (
                  !mismatch &&
                  detail.data?.status !== "unavailable" &&
                  diff.data?.status !== "unavailable" && (
                    <>
                      <div className="pr-snapshot">
                        <span>
                          Head{" "}
                          <code>
                            {detail.data?.headRefOid?.slice(0, 8) ||
                              "unavailable"}
                          </code>
                        </span>
                        <span>
                          Base{" "}
                          <code>
                            {detail.data?.baseRefOid?.slice(0, 8) ||
                              "unavailable"}
                          </code>
                        </span>
                        <SnapshotTime
                          value={
                            detail.data?.fetchedAt ||
                            detail.data?.refreshedAt ||
                            detail.updatedAt
                          }
                        />
                      </div>
                      {list(detail.data?.commits).length > 0 && (
                        <details className="pr-commits">
                          <summary>
                            {detail.data?.commits.length} commits
                          </summary>
                          {list(detail.data?.commits).map((commit, index) => (
                            <div key={commit.oid || commit.hash || index}>
                              <GitCommitHorizontal size={14} />
                              <strong>
                                {commit.messageHeadline || commit.subject}
                              </strong>
                              <code>
                                {(commit.oid || commit.hash || "").slice(0, 8)}
                              </code>
                            </div>
                          ))}
                        </details>
                      )}
                      {list(detail.data?.files).length > 0 && (
                        <details className="pr-commits">
                          <summary>
                            {detail.data?.files.length} changed files
                          </summary>
                          {list(detail.data?.files).map((file) => (
                            <div key={file.path}>
                              <FileCode2 size={14} />
                              <code>{file.path}</code>
                              <span className="text-green">
                                +{file.additions ?? "—"}
                              </span>
                              <span className="text-red">
                                −{file.deletions ?? "—"}
                              </span>
                            </div>
                          ))}
                        </details>
                      )}
                      <Diff
                        data={diff.data}
                        title={`Pull request #${number} · remote diff`}
                      />
                    </>
                  )
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
function LogViewer({
  serviceId,
  receiptId,
}: {
  serviceId?: string;
  receiptId?: string;
}) {
  const [version, setVersion] = useState(0);
  const [offset, setOffset] = useState(0);
  const [text, setText] = useState("");
  const logs = useQuery<RecordData>(
    serviceId ? "services.logs" : receiptId ? "setup.logs" : null,
    { ...(serviceId ? { serviceId } : { receiptId }), offset, limit: 65536 },
    version,
  );
  useEffect(() => {
    setOffset(0);
    setText("");
  }, [serviceId, receiptId]);
  useEffect(() => {
    if (logs.data)
      setText((previous) =>
        offset ? previous + logs.data!.text : logs.data!.text,
      );
  }, [logs.data]);
  return (
    <div className="log-viewer">
      <div className="log-heading">
        <span>
          <Terminal size={15} />
          {serviceId ? "Service logs" : "Setup logs"}
        </span>
        <button
          className="button"
          onClick={() => {
            if (logs.data && logs.data.nextOffset > offset)
              setOffset(logs.data.nextOffset);
            else setVersion((value) => value + 1);
          }}
          disabled={logs.loading}
        >
          <RefreshCw size={14} />
          Read latest
        </button>
      </div>
      <ErrorNotice message={logs.error} />
      {logs.loading && !text ? (
        <Loading />
      ) : (
        <pre>{text || "No output recorded yet."}</pre>
      )}
    </div>
  );
}
function ServicesView({
  detail,
  version,
  busy,
  action,
  openUrl,
}: {
  detail: RecordData;
  version: number;
  busy: boolean;
  action: (name: string, input?: Record<string, unknown>) => Promise<void>;
  openUrl: (url: string) => void;
}) {
  const services = list(detail.services);
  const resources = list(detail.resources);
  const [serviceId, setServiceId] = useState<string>();
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Services & resources</h2>
          <p>
            Owned processes, readiness, and observed ports for this workspace.
          </p>
        </div>
      </div>
      <div className="checkout-runtime-scopes">
        {list(detail.checkouts).map((checkout) => (
          <div key={checkout.id}>
            <GitBranch size={14} />
            <strong>{checkout.repositoryKey}</strong>
            <code>{checkout.currentBranch || "Detached HEAD"}</code>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void action("lifecycle.start", { checkoutId: checkout.id })
              }
            >
              <Play size={12} />
              Start checkout
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void action("lifecycle.stop", { checkoutId: checkout.id })
              }
            >
              <Square size={11} />
              Stop
            </button>
          </div>
        ))}
      </div>
      {!services.length && !resources.length ? (
        <Empty
          icon={<Server size={25} />}
          title="No services configured"
          text="Add services or resources to the project manifest, then explicitly apply the revision to this workspace."
        />
      ) : (
        <div className="runtime-grid">
          {services.map((service) => (
            <article className="runtime-card" key={service.id}>
              <div className="runtime-card-heading">
                <Server size={18} />
                <h3>
                  {service.name ||
                    service.serviceKey ||
                    service.definitionId ||
                    service.logicalId ||
                    service.id}
                </h3>
                <Badge
                  state={
                    service.stale ? "stale" : service.state || service.status
                  }
                />
              </div>
              <SnapshotTime
                value={service.refreshedAt || service.readinessEvidence?.at}
              />
              <p className="mono path-text">
                {service.cwd || service.path || ""}
              </p>
              <div className="port-facts">
                <span>
                  Preferred<strong>{service.preferredPort ?? "—"}</strong>
                </span>
                <span>
                  Assigned
                  <strong>{service.assignedPort ?? service.port ?? "—"}</strong>
                </span>
                <span>
                  Observed
                  <strong>
                    {service.observedPorts?.join(", ") ||
                      service.observedPort ||
                      "Unknown"}
                  </strong>
                </span>
              </div>
              {service.error && (
                <ErrorNotice
                  message={
                    typeof service.error === "string"
                      ? service.error
                      : service.error.message
                  }
                />
              )}
              {service.readiness && (
                <p className="small muted">
                  Readiness:{" "}
                  {typeof service.readiness === "string"
                    ? service.readiness
                    : JSON.stringify(service.readiness)}
                </p>
              )}
              <div className="runtime-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void action("lifecycle.start", { serviceId: service.id })
                  }
                >
                  <Play size={13} />
                  Start
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void action("lifecycle.stop", { serviceId: service.id })
                  }
                >
                  <Square size={12} />
                  Stop
                </button>
                <button
                  className="button"
                  onClick={() => setServiceId(service.id)}
                >
                  <Terminal size={13} />
                  Logs
                </button>
                {service.url && (
                  <button
                    disabled={!isLive(service.state || service.status)}
                    className="icon-button"
                    title={service.url}
                    aria-label={`Open ${service.name || service.id}`}
                    onClick={() => openUrl(service.url)}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                )}
              </div>
            </article>
          ))}
          {resources.map((resource) => (
            <article className="runtime-card resource-card" key={resource.id}>
              <div className="runtime-card-heading">
                <ShieldCheck size={18} />
                <h3>
                  {resource.name ||
                    resource.resourceKey ||
                    resource.definitionId ||
                    resource.logicalId ||
                    resource.id}
                </h3>
                <Badge state={resource.state || resource.status} />
              </div>
              <dl className="resource-facts">
                <dt>Adapter</dt>
                <dd>{resource.adapter || "Not recorded"}</dd>
                <dt>Ownership</dt>
                <dd>
                  {resource.ownership ||
                    resource.identity?.ownership ||
                    "Not verified"}
                </dd>
                <dt>Identity</dt>
                <dd className="mono">
                  {typeof resource.identity === "string"
                    ? resource.identity
                    : JSON.stringify(resource.identity || {})}
                </dd>
                <dt>Port</dt>
                <dd>
                  {resource.observedPorts?.join(", ") ||
                    resource.observedPort ||
                    resource.assignedPort ||
                    resource.port ||
                    "Not allocated"}
                </dd>
              </dl>
              {resource.error && (
                <ErrorNotice
                  message={
                    typeof resource.error === "string"
                      ? resource.error
                      : resource.error.message
                  }
                />
              )}
            </article>
          ))}
        </div>
      )}
      {serviceId && <LogViewer serviceId={serviceId} />}
    </>
  );
}
function SetupView({
  detail,
  version,
  busy,
  action,
}: {
  detail: RecordData;
  version: number;
  busy: boolean;
  action: (name: string, input?: Record<string, unknown>) => Promise<void>;
}) {
  const receipts = useQuery<RecordData[]>(
    "setup.status",
    { workspaceId: detail.workspace.id },
    version,
  );
  const [receiptId, setReceiptId] = useState<string>();
  const manifest = detail.configuration?.manifest || {};
  const recipes = list(manifest.setup);
  const prerequisites = list(manifest.prerequisites);
  const [revisionId, setRevisionId] = useState("");
  const [applyConfirmed, setApplyConfirmed] = useState(false);
  const latest = useQuery<RecordData>(
    "configuration.get",
    { projectId: detail.workspace.projectId },
    version,
  );
  const proposed = useQuery<RecordData>(
    revisionId.trim() ? "configuration.get" : null,
    { projectId: detail.workspace.projectId, revisionId: revisionId.trim() },
    version,
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Workspace preparation</h2>
          <p>
            Repeatable setup receipts are tied to this workspace’s configuration
            and inputs.
          </p>
        </div>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void action("setup.run")}
        >
          <Play size={14} />
          Prepare workspace
        </button>
      </div>
      <ErrorNotice message={receipts.error} stale={!!receipts.data} />
      {prerequisites.length > 0 && (
        <section className="settings-card">
          <h3>Machine prerequisites</h3>
          {prerequisites.map((prerequisite) => (
            <div className="prerequisite-row" key={prerequisite.id}>
              <Terminal size={15} />
              <strong>{prerequisite.id}</strong>
              <code>
                {prerequisite.executable} {(prerequisite.args || []).join(" ")}
              </code>
              <span className="pill">Checked during preparation</span>
            </div>
          ))}
        </section>
      )}
      {!recipes.length && !list(receipts.data).length ? (
        <Empty
          icon={<Check size={25} />}
          title="No setup recipes configured"
          text="This revision declares no workspace preparation steps. Service readiness is reported separately."
        />
      ) : (
        <div className="setup-steps">
          {recipes.map((recipe) => {
            const receipt = list(receipts.data)
              .filter(
                (item) =>
                  (item.recipeId ||
                    item.setupId ||
                    item.stepId ||
                    item.logicalId) === recipe.id,
              )
              .at(-1);
            return (
              <article className="setup-step" key={recipe.id}>
                <div className="setup-step-icon">
                  <Terminal size={18} />
                </div>
                <div>
                  <h3>{recipe.id}</h3>
                  <p>
                    <code>
                      {recipe.executable} {(recipe.args || []).join(" ")}
                    </code>
                  </p>
                  <small>
                    {recipe.repository} ·{" "}
                    {recipe.runPolicy === "always"
                      ? "Runs every preparation"
                      : "Reused when inputs match"}
                  </small>
                </div>
                <Badge state={receipt?.state || receipt?.status || "pending"} />
                {receipt && (
                  <button
                    className="button"
                    onClick={() => setReceiptId(receipt.id)}
                  >
                    Logs
                  </button>
                )}
              </article>
            );
          })}
          {!recipes.length &&
            list(receipts.data).map((receipt) => (
              <article className="setup-step" key={receipt.id}>
                <Terminal size={17} />
                <div>
                  <h3>
                    {receipt.recipeId ||
                      receipt.setupId ||
                      receipt.logicalId ||
                      receipt.id}
                  </h3>
                  <p>
                    {dateLabel(
                      receipt.finishedAt ||
                        receipt.updatedAt ||
                        receipt.createdAt,
                    )}
                  </p>
                </div>
                <Badge state={receipt.state || receipt.status} />
                <button
                  className="button"
                  onClick={() => setReceiptId(receipt.id)}
                >
                  Logs
                </button>
              </article>
            ))}
        </div>
      )}
      {receiptId && <LogViewer receiptId={receiptId} />}
      <section className="settings-card revision-card">
        <h3>Pinned configuration</h3>
        <p className="small muted">
          Saving a project configuration creates a new revision. Applying it is
          an explicit workspace action.
        </p>
        <dl className="resource-facts">
          <dt>Current revision</dt>
          <dd>
            <code>{detail.workspace.configurationRevisionId}</code>
          </dd>
          <dt>Latest revision</dt>
          <dd>
            <code>{latest.data?.id || "Unavailable"}</code>
          </dd>
        </dl>
        <ErrorNotice message={latest.error} />
        <label className="field">
          Revision to apply
          <input
            placeholder={latest.data?.id || "Configuration revision ID"}
            value={revisionId}
            onChange={(event) => {
              setRevisionId(event.target.value);
              setApplyConfirmed(false);
            }}
          />
        </label>
        <details className="discovery-evidence">
          <summary>Current and proposed configuration</summary>
          <div className="revision-comparison">
            <div>
              <h4>Current</h4>
              <pre className="json-output">
                {JSON.stringify(manifest, null, 2)}
              </pre>
            </div>
            <div>
              <h4>Selected revision</h4>
              <pre className="json-output">
                {JSON.stringify(proposed.data?.manifest || {}, null, 2)}
              </pre>
            </div>
          </div>
        </details>
        <ErrorNotice message={proposed.error} />
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={applyConfirmed}
            onChange={(event) => setApplyConfirmed(event.target.checked)}
          />
          Apply the selected revision to this workspace.
        </label>
        <button
          className="button"
          disabled={
            busy ||
            !revisionId.trim() ||
            !applyConfirmed ||
            proposed.loading ||
            !proposed.data ||
            !!proposed.error
          }
          onClick={() =>
            void action("configuration.apply", {
              revisionId: revisionId.trim(),
            })
          }
        >
          <ShieldCheck size={14} />
          Apply revision
        </button>
      </section>
    </>
  );
}
