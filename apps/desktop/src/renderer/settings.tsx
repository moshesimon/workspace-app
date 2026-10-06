import { useState } from "react";
import {
  Check,
  ChevronRight,
  Code2,
  ExternalLink,
  Leaf,
  Link2,
  Loader2,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { errorMessage, list, query, useQuery, type RecordData } from "./api.js";
import { Badge, Empty, ErrorNotice, Loading, Modal } from "./components.js";
import type { RunAction } from "./App.js";

export function SettingsView({
  version,
  run,
  status,
}: {
  version: number;
  run: RunAction;
  status?: RecordData;
}) {
  const integration = useQuery<RecordData>("integration.status", {}, version);
  const [preview, setPreview] = useState<RecordData>();
  const [action, setAction] = useState<"connect" | "disconnect">("connect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [approved, setApproved] = useState(false);
  const inspect = async (next: "connect" | "disconnect") => {
    setAction(next);
    setBusy(true);
    setError(undefined);
    setApproved(false);
    try {
      setPreview(await query("integration.preview", { action: next }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    setError(undefined);
    try {
      await run(
        action === "connect" ? "integration.apply" : "integration.disconnect",
        { previewId: preview.id },
      );
      setPreview(undefined);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">AT HOME ON YOUR MACHINE</div>
          <h1>Settings</h1>
          <p>Your local controller and agent connection.</p>
        </div>
      </div>
      <ErrorNotice message={error} />
      <section className="settings-card integration-card">
        <div className="settings-card-title">
          <div className="settings-icon">
            <Code2 size={22} />
          </div>
          <div>
            <h2>Connect to Codex</h2>
            <p>
              Let your agent manage the same projects and workspaces through
              MCP.
            </p>
          </div>
          <Badge
            state={integration.data?.connected ? "connected" : "disconnected"}
          >
            {integration.data?.connected ? "Connected" : "Not connected"}
          </Badge>
        </div>
        <ErrorNotice message={integration.error} />
        {integration.loading && !integration.data ? (
          <Loading />
        ) : (
          <>
            <p className="settings-description">
              The connection installs Grove’s local MCP server entry and project
              onboarding skill. Preview every file change before applying it.
            </p>
            <dl className="settings-paths">
              <dt>Executable</dt>
              <dd>
                <code>{integration.data?.executable || "Not available"}</code>
              </dd>
              <dt>Codex configuration</dt>
              <dd>
                <code>{integration.data?.configPath || "Not available"}</code>
              </dd>
              <dt>Skill folder</dt>
              <dd>
                <code>{integration.data?.skillPath || "Not available"}</code>
              </dd>
            </dl>
            <div className="settings-actions">
              {integration.data?.connected ? (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void inspect("disconnect")}
                >
                  <Unplug size={15} />
                  Preview disconnect
                </button>
              ) : (
                <button
                  className="button primary"
                  disabled={busy || !!integration.error}
                  onClick={() => void inspect("connect")}
                >
                  {busy ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <Link2 size={15} />
                  )}
                  Preview connection
                  <ChevronRight size={15} />
                </button>
              )}
            </div>
          </>
        )}
      </section>
      <section className="settings-card">
        <div className="settings-card-title">
          <div className="settings-icon">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h2>Local controller</h2>
            <p>One controller keeps desktop and agent operations in sync.</p>
          </div>
          <Badge state={status ? "running" : "unknown"} />
        </div>
        <dl className="settings-paths">
          <dt>Version</dt>
          <dd>{status?.version || "Unavailable"}</dd>
          <dt>Process</dt>
          <dd>{status?.pid || "Unavailable"}</dd>
          <dt>State directory</dt>
          <dd>
            <code>{status?.stateRoot || "Unavailable"}</code>
          </dd>
          <dt>Started</dt>
          <dd>
            {status?.startedAt
              ? new Date(status.startedAt).toLocaleString()
              : "Unavailable"}
          </dd>
        </dl>
        <div className="form-note">
          <Leaf size={17} />
          <p>
            Closing this window leaves managed services available to your agent.
            Use Stop in the workspace to shut down its owned processes.
          </p>
        </div>
      </section>
      {preview && (
        <Modal
          wide
          title={
            action === "connect"
              ? "Review Codex connection"
              : "Review Codex disconnect"
          }
          subtitle="These are the exact local file changes proposed by the controller."
          onClose={busy ? () => {} : () => setPreview(undefined)}
        >
          <div className="modal-body">
            <ErrorNotice message={error} />
            {list(preview.conflicts).length > 0 && (
              <ErrorNotice
                message={`Conflicts must be resolved before applying: ${JSON.stringify(preview.conflicts)}`}
              />
            )}
            {list(preview.changes).map((change, index) => (
              <section
                className="integration-change"
                key={change.path || index}
              >
                <h3 className="mono">{change.path}</h3>
                <div className="revision-comparison">
                  <div>
                    <h4>Before</h4>
                    <pre>{change.before ?? "(file does not exist)"}</pre>
                  </div>
                  <div>
                    <h4>After</h4>
                    <pre>{change.after ?? "(owned entry removed)"}</pre>
                  </div>
                </div>
              </section>
            ))}
            {!list(preview.changes).length && (
              <Empty
                title="No file changes proposed"
                text="The controller will verify the connection state when applying this preview."
              />
            )}
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
                disabled={busy}
              />
              Apply the local configuration and skill changes shown above.
            </label>
          </div>
          <div className="modal-footer">
            <button
              className="button"
              disabled={busy}
              onClick={() => setPreview(undefined)}
            >
              Cancel
            </button>
            <button
              className={`button ${action === "connect" ? "primary" : "danger"}`}
              disabled={busy || !approved || list(preview.conflicts).length > 0}
              onClick={() => void apply()}
            >
              {busy ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Check size={15} />
              )}
              {busy
                ? "Applying…"
                : action === "connect"
                  ? "Connect Codex"
                  : "Disconnect"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
