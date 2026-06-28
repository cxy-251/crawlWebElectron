import { app } from "electron";
import { createMainWindow } from "./app/createMainWindow";

app.setName("BrowserWorkflowForge");

if (process.env.CWE_REMOTE_DEBUGGING_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.CWE_REMOTE_DEBUGGING_PORT);
}

app.whenReady().then(() => {
  createMainWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});
