import { ipcMain } from "electron";
import type { IpcContext } from "./registerIpcHandlers";

export function registerBrowserIpcHandlers({ browserWorkspace }: IpcContext): void {
  ipcMain.handle("browser:goto", async (_event, url: string) => {
    await browserWorkspace.navigation.goto(url);
  });

  ipcMain.handle("browser:reload", () => {
    browserWorkspace.navigation.reload();
  });

  ipcMain.handle("browser:get-state", () => browserWorkspace.state.getState());
}

