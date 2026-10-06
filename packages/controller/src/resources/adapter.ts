import type { ResolutionContext } from "../services/profiles.js";
export interface ResourceContext {
  workspaceId: string;
  checkoutId: string;
  configurationRevisionId: string;
  namespace: string;
  profile: any;
  resolved: {
    executable?: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
  };
  resolution: ResolutionContext;
  assignedPort?: number;
  url?: string;
  logPath: string;
  persist?: (handle: ResourceHandle) => void;
}
export interface ResourceHandle {
  id: string;
  workspaceId: string;
  checkoutId: string;
  configurationRevisionId: string;
  logicalId: string;
  adapter: string;
  namespace: string;
  identity?: string;
  ownership: "owned" | "external" | "unknown";
  state: string;
  assignedPort?: number;
  url?: string;
  observedPorts: number[];
  dataPaths: string[];
  disposablePaths: string[];
  pid?: number;
  processGroup?: number;
  startIdentity?: string;
  logPath: string;
  profile: any;
  [key: string]: any;
}
export interface ResourceStatus {
  state: string;
  observedPorts: number[];
  identity?: string;
  namespace?: string;
  ownership?: string;
  dataPaths?: string[];
  [key: string]: any;
}
export interface RuntimeAdapter {
  start(context: ResourceContext): Promise<ResourceHandle>;
  inspect(handle: ResourceHandle): Promise<ResourceStatus>;
  stop(handle: ResourceHandle): Promise<void>;
  destroy(handle: ResourceHandle, preview: any): Promise<void>;
}
