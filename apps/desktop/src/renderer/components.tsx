import { useEffect, useRef, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronDown,
  FileCode2,
  Folder,
  Loader2,
  X,
} from "lucide-react";
import { dateLabel, isLive, list, stateLabel, type RecordData } from "./api.js";

export function Badge({
  state,
  children,
}: {
  state?: string;
  children?: ReactNode;
}) {
  const tone =
    isLive(state) || ["open", "connected"].includes(state || "")
      ? "green"
      : ["failed", "degraded", "partial"].includes(state || "")
        ? "red"
        : ["starting", "running", "queued", "preparing"].includes(state || "")
          ? "amber"
          : state === "merged" || state === "MERGED"
            ? "purple"
            : "";
  return (
    <span className={`badge ${tone}`}>
      <span className="status-dot" />
      {children || stateLabel(state)}
    </span>
  );
}
export function ErrorNotice({
  message,
  stale = false,
}: {
  message?: string;
  stale?: boolean;
}) {
  return message ? (
    <div className="notice error" role="alert">
      <AlertCircle size={16} />
      <span>
        {stale && <strong>Showing the last successful snapshot. </strong>}
        {message}
      </span>
    </div>
  ) : null;
}
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <Loader2 size={18} className="spin" />
      {label}
    </div>
  );
}
export function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon || <Folder size={25} />}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current
      ?.querySelector<HTMLElement>("input,textarea,select,button")
      ?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const elements = Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]",
        ) || [],
      );
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-heading">
          <div>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Diff({ data, title }: { data?: RecordData; title?: string }) {
  if (!data)
    return (
      <Empty
        icon={<FileCode2 size={25} />}
        title="Select a file to inspect"
        text="Its changes will appear here."
      />
    );
  return (
    <div className="diff">
      <div className="diff-heading">
        <FileCode2 size={16} />
        <span>{title || "Diff"}</span>
        {data.truncated && <span className="badge amber">Truncated</span>}
      </div>
      {data.binary ? (
        <Empty
          title="Binary file"
          text="A text diff is unavailable for this file."
        />
      ) : !data.text ? (
        <Empty
          title="No text changes"
          text="This file may be empty or have only metadata changes."
        />
      ) : (
        <div className="diff-lines">
          {String(data.text)
            .split("\n")
            .map((line, i) => (
              <div
                key={i}
                className={`diff-line ${line.startsWith("@@") ? "hunk" : line.startsWith("+") && !line.startsWith("+++") ? "addition" : line.startsWith("-") && !line.startsWith("---") ? "deletion" : ""}`}
              >
                <span className="line-number">{i + 1}</span>
                <code>{line || " "}</code>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
export type FileSelection = {
  checkoutId: string;
  path: string;
  area: "staged" | "unstaged" | "untracked";
};
function Files({
  files,
  checkoutId,
  selected,
  onSelect,
  prefix = "",
}: {
  files: RecordData[];
  checkoutId: string;
  selected?: FileSelection;
  onSelect: (file: FileSelection) => void;
  prefix?: string;
}) {
  const folders = new Map<string, RecordData[]>();
  const leaves: RecordData[] = [];
  for (const file of files) {
    const remainder = String(file.path).slice(prefix.length);
    const slash = remainder.indexOf("/");
    if (slash < 0) leaves.push(file);
    else {
      const folder = remainder.slice(0, slash);
      folders.set(folder, [...(folders.get(folder) || []), file]);
    }
  }
  return (
    <>
      {Array.from(folders)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([folder, children]) => (
          <details key={folder} open className="tree-folder">
            <summary>
              <ChevronDown size={13} />
              <Folder size={14} />
              {folder}
            </summary>
            <div className="tree-indent">
              <Files
                files={children}
                checkoutId={checkoutId}
                selected={selected}
                onSelect={onSelect}
                prefix={`${prefix}${folder}/`}
              />
            </div>
          </details>
        ))}
      {leaves.map((file) => {
        const areas: FileSelection["area"][] = file.untracked
          ? ["untracked"]
          : ([file.staged && "staged", file.unstaged && "unstaged"].filter(
              Boolean,
            ) as FileSelection["area"][]);
        return (areas.length ? areas : ["unstaged" as const]).map((area) => (
          <button
            title={
              file.originalPath
                ? `Renamed from ${file.originalPath}`
                : file.path
            }
            key={`${file.path}:${area}`}
            className={`tree-file ${selected?.checkoutId === checkoutId && selected.path === file.path && selected.area === area ? "selected" : ""}`}
            onClick={() => onSelect({ checkoutId, path: file.path, area })}
          >
            <FileCode2 size={14} />
            <span>{String(file.path).slice(prefix.length)}</span>
            <small>
              {area === "untracked"
                ? "??"
                : (area === "staged"
                    ? file.indexStatus?.trim()
                    : file.worktreeStatus?.trim()) || "M"}
            </small>
            <span className="file-area">{area}</span>
          </button>
        ));
      })}
    </>
  );
}
export function FileTree({
  checkouts,
  snapshots,
  selected,
  onSelect,
}: {
  checkouts: RecordData[];
  snapshots: Record<string, any>;
  selected?: FileSelection;
  onSelect: (file: FileSelection) => void;
}) {
  return (
    <div className="file-tree">
      {checkouts.map((checkout) => (
        <details key={checkout.id} open className="checkout-tree">
          <summary>
            <ChevronDown size={14} />
            <strong>{checkout.repositoryKey}</strong>
            <span>{snapshots[checkout.id]?.files?.length ?? "—"}</span>
          </summary>
          <div className="tree-branch">
            {checkout.currentBranch || "Detached HEAD"}
          </div>
          {snapshots[checkout.id]?.error ? (
            <ErrorNotice message={snapshots[checkout.id].error} />
          ) : !snapshots[checkout.id] ? (
            <Loading />
          ) : (
            <>
              <div className="tree-summary">
                Staged {snapshots[checkout.id].staged ?? 0} · Unstaged{" "}
                {snapshots[checkout.id].unstaged ?? 0} · Untracked{" "}
                {snapshots[checkout.id].untracked ?? 0}
              </div>
              {list(snapshots[checkout.id].files).length ? (
                <Files
                  files={snapshots[checkout.id].files}
                  checkoutId={checkout.id}
                  selected={selected}
                  onSelect={onSelect}
                />
              ) : (
                <p className="tree-empty">
                  <Check size={15} />
                  No local changes
                </p>
              )}
            </>
          )}
        </details>
      ))}
    </div>
  );
}
export function SnapshotTime({ value }: { value?: string | Date }) {
  return (
    <span className="snapshot-time">
      {value
        ? `Checked ${dateLabel(value instanceof Date ? value.toISOString() : value)}`
        : "Not yet refreshed"}
    </span>
  );
}
export function ExternalLink({
  url,
  label,
  onOpen,
}: {
  url?: string;
  label: string;
  onOpen: (url: string) => void;
}) {
  return url ? (
    <button className="text-button" onClick={() => onOpen(url)}>
      {label}
      <ArrowUpRight size={14} />
    </button>
  ) : null;
}
