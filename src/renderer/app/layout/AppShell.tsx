import { ReactNode } from "react";
import { ToolPane } from "./ToolPane";

export function AppShell({ toolPane }: { toolPane: ReactNode }) {
  return <ToolPane>{toolPane}</ToolPane>;
}
