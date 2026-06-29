import type { WorkflowDescriptor } from "../../shared/workflows/types";

const WORKFLOW_DESCRIPTORS: WorkflowDescriptor[] = [
  {
    id: "kuaishou.upload-single.v1",
    version: "1.0.0",
    title: "Kuaishou single video upload",
    site: "Kuaishou",
    engine: "electron",
    status: "available",
    risk: "standard",
    capabilities: ["electron.webcontents", "chromium.cdp", "file-upload", "local-api"],
    source: { kind: "built-in" },
    runApiPath: "/api/kuaishou/upload-single"
  },
  {
    id: "boss.search-and-communicate.v1",
    version: "1.0.0",
    title: "Boss search and communication",
    site: "Boss Zhipin",
    engine: "safari-rpa",
    status: "external",
    risk: "high",
    capabilities: ["safari.real-browser", "safari.dom", "safari.write.click", "ledger", "reports"],
    source: {
      kind: "integrated-python",
      relativePath: "src/safari-rpa",
      apiBaseUrl: "http://127.0.0.1:3211/api/v1"
    }
  },
  {
    id: "twitter.collect-raw.v1",
    version: "1.0.0",
    title: "Twitter/X raw tweet collection",
    site: "X/Twitter",
    engine: "safari-rpa",
    status: "external",
    risk: "high",
    capabilities: ["safari.real-browser", "safari.dom", "read-only", "period-artifacts"],
    source: {
      kind: "integrated-python",
      relativePath: "src/safari-rpa",
      apiBaseUrl: "http://127.0.0.1:3211/api/v1"
    }
  },
  {
    id: "twitter.clean-prompts.v1",
    version: "1.0.0",
    title: "Twitter/X prompt cleanup",
    site: "X/Twitter",
    engine: "safari-rpa",
    status: "external",
    risk: "standard",
    capabilities: ["local-llm", "period-ledger", "promptloom"],
    source: {
      kind: "integrated-python",
      relativePath: "src/safari-rpa",
      apiBaseUrl: "http://127.0.0.1:3211/api/v1"
    }
  },
  {
    id: "boss.safari-extension.prototype.v1",
    version: "0.1.0",
    title: "Boss Safari extension prototype",
    site: "Boss Zhipin",
    engine: "safari-extension",
    status: "prototype",
    risk: "high",
    capabilities: ["safari-extension", "content-script", "native-message-reference"],
    source: {
      kind: "integrated-safari-extension",
      relativePath: "src/safari-extension-boss"
    }
  }
];

export class WorkflowRegistry {
  private readonly descriptors: WorkflowDescriptor[];

  constructor(descriptors: WorkflowDescriptor[] = WORKFLOW_DESCRIPTORS) {
    this.descriptors = [...descriptors].sort((left, right) => left.id.localeCompare(right.id));
  }

  list(): WorkflowDescriptor[] {
    return [...this.descriptors];
  }

  get(workflowId: string): WorkflowDescriptor | null {
    return this.descriptors.find((descriptor) => descriptor.id === workflowId) || null;
  }
}

export function createWorkflowRegistry(): WorkflowRegistry {
  return new WorkflowRegistry();
}
