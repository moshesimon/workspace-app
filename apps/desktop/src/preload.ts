import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("worktree", {
  call: (name: string, input: Record<string, unknown> = {}) =>
    ipcRenderer.invoke("worktree:call", name, input),
  chooseFolder: () => ipcRenderer.invoke("worktree:chooseFolder"),
  openExternal: (url: string) =>
    ipcRenderer.invoke("worktree:openExternal", url),
});
