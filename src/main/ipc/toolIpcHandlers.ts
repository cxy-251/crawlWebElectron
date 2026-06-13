import { ipcMain } from "electron";
import { ToolRegistry } from "../tools/ToolRegistry";

export function registerToolIpcHandlers(): void {
  const registry = new ToolRegistry();

  ipcMain.handle("tools:list-tools", () => registry.listTools());
}

