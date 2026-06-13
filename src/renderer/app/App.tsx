import { useState } from "react";
import { AppShell } from "./layout/AppShell";
import { ToolHome } from "../tools/home/ToolHome";
import { VideoUploadPage } from "../tools/video-upload/VideoUploadPage";

type Route = "home" | "video-upload";

export function App() {
  const [route, setRoute] = useState<Route>("home");

  return (
    <AppShell
      toolPane={
        route === "home" ? (
          <ToolHome onEnterVideoUpload={() => setRoute("video-upload")} />
        ) : (
          <VideoUploadPage onBack={() => setRoute("home")} />
        )
      }
    />
  );
}

