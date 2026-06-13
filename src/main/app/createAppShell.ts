import { BaseWindow, WebContentsView } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TOOL_PANE_WIDTH = 420;
const MIN_BROWSER_WIDTH = 760;

export function createAppShell(window: BaseWindow): WebContentsView {
  const rendererView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "../../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  const rendererUrl =
    process.env.ELECTRON_RENDERER_URL ||
    pathToFileURL(path.join(__dirname, "../../renderer/index.html")).toString();

  window.contentView.addChildView(rendererView);

  const updateBounds = () => {
    const bounds = window.getContentBounds();
    rendererView.setBounds({
      x: Math.max(MIN_BROWSER_WIDTH, bounds.width - TOOL_PANE_WIDTH),
      y: 0,
      width: TOOL_PANE_WIDTH,
      height: Math.max(320, bounds.height)
    });
  };

  updateBounds();
  window.on("resize", updateBounds);
  window.on("maximize", updateBounds);
  window.on("unmaximize", updateBounds);
  void rendererView.webContents.loadURL(rendererUrl);
  rendererView.webContents.once("did-finish-load", () => {
    if (process.env.CWE_OPEN_DEVTOOLS === "1") {
      rendererView.webContents.openDevTools({ mode: "detach" });
    }
  });
  return rendererView;
}
