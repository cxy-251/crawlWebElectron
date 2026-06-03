import { app } from "electron";
import { createAppWindow } from "./appWindow";
import { registerIpc } from "./ipc";
import { logger } from "./logger";
import { WebViewController } from "./webViewController";

let controller: WebViewController | null = null;

app.setName("CrawlWebElectron");

app.whenReady().then(() => {
  logger.info("app", "ready");

  const window = createAppWindow();
  controller = new WebViewController(window);
  registerIpc(controller);

  window.on("closed", () => {
    logger.info("window", "closed");
    controller?.destroy();
    controller = null;
  });
});

app.on("window-all-closed", () => {
  logger.info("app", "all windows closed");
  app.quit();
});

app.on("before-quit", () => {
  logger.info("app", "before quit");
});

