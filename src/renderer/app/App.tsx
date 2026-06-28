import { useState } from "react";
import { AppShell } from "./layout/AppShell";
import { ToolHome } from "../tools/home/ToolHome";
import { VideoUploadPage } from "../tools/video-upload/VideoUploadPage";
import { WorkflowCatalogPage } from "../tools/workflows/WorkflowCatalogPage";

type Route = "home" | "video-upload" | "workflows";

export function App() {
  const [route, setRoute] = useState<Route>("home");

  return (
    <AppShell
      toolPane={
        route === "home" ? (
          <ToolHome
            onEnterVideoUpload={() => setRoute("video-upload")}
            onEnterWorkflows={() => setRoute("workflows")}
          />
        ) : route === "video-upload" ? (
          <VideoUploadPage onBack={() => setRoute("home")} />
        ) : (
          <WorkflowCatalogPage onBack={() => setRoute("home")} onOpenVideoUpload={() => setRoute("video-upload")} />
        )
      }
    />
  );
}
