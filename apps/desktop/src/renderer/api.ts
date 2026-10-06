import { useEffect, useRef, useState } from "react";

export type RecordData = Record<string, any>;
export type Operation = {
  id: string;
  action: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  result?: any;
  error?: { code: string; message: string };
  outcomes?: any[];
};
export type Bridge = {
  call(name: string, input?: Record<string, unknown>): Promise<any>;
  chooseFolder(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
};
declare global {
  interface Window {
    worktree: Bridge;
  }
}
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : JSON.stringify(error);
}
export async function query<T = any>(
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  if (!window.worktree)
    throw new Error(
      "The desktop bridge is unavailable. Open Grove in the desktop app to connect to your local controller.",
    );
  return window.worktree.call(name, input);
}
export function useQuery<T = any>(
  name: string | null,
  input: Record<string, unknown>,
  version = 0,
) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    loading: boolean;
    updatedAt?: Date;
  }>({ loading: !!name });
  const key = JSON.stringify(input);
  const identity = `${name}:${key}`;
  const previousIdentity = useRef(identity);
  useEffect(() => {
    let current = true;
    if (!name) {
      setState({ loading: false });
      return;
    }
    const changed = previousIdentity.current !== identity;
    previousIdentity.current = identity;
    setState((previous) => ({
      ...(changed ? {} : previous),
      loading: true,
      error: undefined,
    }));
    query<T>(name, JSON.parse(key))
      .then((data) => {
        if (current) setState({ data, loading: false, updatedAt: new Date() });
      })
      .catch((error) => {
        if (current)
          setState((previous) => ({
            ...previous,
            loading: false,
            error: errorMessage(error),
          }));
      });
    return () => {
      current = false;
    };
  }, [name, key, version]);
  return state;
}
export async function mutate(
  name: string,
  input: Record<string, unknown>,
  onOperation: (operation: Operation) => void,
) {
  let operation = await query<Operation>(name, {
    ...input,
    idempotencyKey: crypto.randomUUID(),
  });
  if (!operation?.id || !operation?.status)
    throw new Error(
      `The controller returned an invalid operation for ${name}.`,
    );
  onOperation(operation);
  const deadline = Date.now() + 10 * 60_000;
  while (operation.status === "queued" || operation.status === "running") {
    if (Date.now() > deadline)
      throw new Error(
        `Operation ${operation.id} is still running. Follow its progress in Activity.`,
      );
    await new Promise((resolve) => setTimeout(resolve, 600));
    operation = await query<Operation>("operations.get", {
      operationId: operation.id,
    });
    onOperation(operation);
  }
  if (operation.status === "failed" || operation.status === "partial")
    throw new Error(
      operation.error?.message ||
        `Operation ${operation.status}. Check Activity for each target’s outcome.`,
    );
  return operation.result;
}
export function dateLabel(value: string | undefined | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}
export function list(value: any): RecordData[] {
  return Array.isArray(value) ? value : [];
}
export function stateLabel(value: any) {
  const raw = String(value || "unknown");
  return raw
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (x) => x.toUpperCase());
}
export function isLive(value: any) {
  return ["running", "active", "ready", "listening", "succeeded"].includes(
    String(value).toLowerCase(),
  );
}
