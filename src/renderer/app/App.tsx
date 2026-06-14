import { useState } from "react";
import { AppShell } from "./layout/AppShell";
import { BrowserAutomationPage } from "../tools/browser-automation/BrowserAutomationPage";
import { ToolHome } from "../tools/home/ToolHome";
import { VideoUploadPage } from "../tools/video-upload/VideoUploadPage";

type Route = "home" | "video-upload" | "browser-automation";

export function App() {
  const [route, setRoute] = useState<Route>("home");

  return (
    <AppShell
      toolPane={
        route === "home" ? (
          <ToolHome
            onEnterVideoUpload={() => setRoute("video-upload")}
            onEnterBrowserAutomation={() => setRoute("browser-automation")}
          />
        ) : route === "video-upload" ? (
          <VideoUploadPage onBack={() => setRoute("home")} />
        ) : (
          <BrowserAutomationPage onBack={() => setRoute("home")} />
        )
      }
    />
  );
}
