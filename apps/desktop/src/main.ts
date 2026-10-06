import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultStateRoot } from "../../../packages/client/src/paths.js";
import { connectOrStart } from "../../../packages/client/src/connect.js";
import { startController } from "../../../packages/controller/src/server.js";
import { serveMcp } from "../../../packages/mcp/src/server.js";
import { parseCommand } from "../../../packages/contracts/src/commands.js";
async function main() {
  const mode =
    process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ??
    "desktop";
  const stateRoot = defaultStateRoot();
  const isNode =
    !process.versions.electron || process.env.ELECTRON_RUN_AS_NODE === "1";
  let electron: any;
  if (!isNode) {
    electron = await import("electron");
    electron.app.setName("Worktree Manager");
    if (mode !== "desktop") electron.app.dock?.hide();
    await electron.app.whenReady();
  }
  const applicationRoot = isNode
    ? join(__dirname, "..")
    : electron.app.getAppPath();
  if (mode === "controller") {
    const server = await startController(stateRoot, {
      executable: process.execPath,
      skillRoot: join(applicationRoot, "skills", "worktree-manager"),
    });
    let closing = false;
    const stop = async () => {
      if (closing) return;
      closing = true;
      await server.close();
      if (electron) electron.app.quit();
    };
    process.on("SIGTERM", () => void stop());
    process.on("SIGINT", () => void stop());
    server.server.on("close", () => {
      if (electron) electron.app.quit();
    });
    return;
  }
  const args = isNode
    ? [join(__dirname, "main.cjs"), "--mode=controller"]
    : electron.app.isPackaged
      ? ["--mode=controller"]
      : [applicationRoot, "--mode=controller"];
  const client = await connectOrStart({
    stateRoot,
    executable: process.execPath,
    args,
  });
  if (mode === "mcp") {
    await serveMcp(client);
    process.stdin.on("end", () => {
      if (electron) electron.app.quit();
    });
    return;
  }
  if (mode !== "desktop") throw new Error(`Unknown runtime mode: ${mode}`);
  if (!electron) throw new Error("Desktop mode requires Electron");
  const { app, BrowserWindow, ipcMain, dialog, shell } = electron;
  app.dock?.show();
  const renderer = pathToFileURL(
    join(__dirname, "renderer", "index.html"),
  ).href;
  const validSender = (event: any) => {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !event.senderFrame.url.startsWith(renderer)
    )
      throw new Error("Untrusted renderer");
  };
  ipcMain.handle(
    "worktree:call",
    async (event: any, name: string, input: unknown) => {
      validSender(event);
      parseCommand(name, input);
      return client.call(name, input as any);
    },
  );
  ipcMain.handle("worktree:chooseFolder", async (event: any) => {
    validSender(event);
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("worktree:openExternal", async (event: any, value: string) => {
    validSender(event);
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Only HTTP(S) URLs are supported");
    await shell.openExternal(url.href);
  });
  const openWindow = () => {
    const window = new BrowserWindow({
      width: 1380,
      height: 960,
      minWidth: 900,
      minHeight: 650,
      title: "Worktree Manager",
      backgroundColor: "#f7f8f6",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 20, y: 20 },
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event: any, url: string) => {
      if (url !== renderer) event.preventDefault();
    });
    window.loadURL(renderer);
    return window;
  };
  openWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) openWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
