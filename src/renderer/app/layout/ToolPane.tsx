import { ReactNode } from "react";

export function ToolPane({ children }: { children: ReactNode }) {
  return <aside className="h-full min-w-0 overflow-auto bg-white p-5 text-slate-900">{children}</aside>;
}
