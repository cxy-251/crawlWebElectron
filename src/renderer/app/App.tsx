import { useState } from "react";
import { AppShell } from "./layout/AppShell";
import { ToolHome } from "../tools/home/ToolHome";
import { VideoUploadPage } from "../tools/kuaishou/VideoUploadPage";
import { WorkflowCatalogPage } from "../tools/workflows/WorkflowCatalogPage";

type Route = "home" | "kuaishou" | "workflows";

export function App() {
  const [route, setRoute] = useState<Route>("home");

  return (
    <AppShell
      toolPane={
        route === "home" ? (
          <ToolHome
            onEnterKuaishou={() => setRoute("kuaishou")}
            onEnterWorkflows={() => setRoute("workflows")}
          />
        ) : route === "kuaishou" ? (
          <VideoUploadPage onBack={() => setRoute("home")} />
        ) : (
          <WorkflowCatalogPage onBack={() => setRoute("home")} onOpenKuaishou={() => setRoute("kuaishou")} />
        )
      }
    />
  );
}
