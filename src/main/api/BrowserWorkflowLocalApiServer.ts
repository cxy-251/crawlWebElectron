import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { KuaishouUploadAdapter } from "../video-upload/kuaishou/KuaishouUploadAdapter";
import { isKuaishouPageActionError } from "../video-upload/kuaishou/KuaishouPageBinding";
import type { WorkflowRegistry } from "../workflows/WorkflowRegistry";
import type { WorkflowRuntimeService } from "../workflows/WorkflowRuntimeService";
import { KuaishouLocalApiRoutes } from "./KuaishouLocalApiRoutes";
import type { JsonRecord, LocalApiRequest, LocalApiRouteResult } from "./LocalApiTypes";
import { WorkflowLocalApiRoutes } from "./WorkflowLocalApiRoutes";

export class BrowserWorkflowLocalApiServer {
  private server: Server | null = null;
  private readonly routes: Array<{ handle(request: LocalApiRequest): Promise<LocalApiRouteResult> }>;

  constructor(
    adapter: KuaishouUploadAdapter,
    workflowRegistry: WorkflowRegistry,
    workflowRuntimeService: WorkflowRuntimeService
  ) {
    this.routes = [
      new WorkflowLocalApiRoutes(workflowRegistry, workflowRuntimeService),
      new KuaishouLocalApiRoutes(adapter)
    ];
  }

  start(): void {
    if (this.server) return;

    const port = Number(process.env.CWE_API_PORT || 3218);
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server.listen(port, "127.0.0.1", () => {
      console.info(`[api] listening http://127.0.0.1:${port}`);
    });
  }

  close(): void {
    this.server?.close();
    this.server = null;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    if (request.method === "OPTIONS") {
      this.send(response, 204, null);
      return;
    }

    if (!this.authorized(request)) {
      this.send(response, 401, { ok: false, error: { code: "UNAUTHORIZED", message: "Missing or invalid API token" } });
      return;
    }

    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const method = request.method || "GET";
      const routeRequest = {
        request,
        method,
        url,
        readJson: (bodyRequest: IncomingMessage) => this.readJson(bodyRequest)
      };

      for (const route of this.routes) {
        const result = await route.handle(routeRequest);
        if (result.handled) {
          this.send(response, result.statusCode, result.payload);
          return;
        }
      }

      this.send(response, 404, { ok: false, error: { code: "NOT_FOUND", message: "API route not found" } });
    } catch (error) {
      this.send(response, 500, this.serializeError(error));
    }
  }

  private authorized(request: IncomingMessage): boolean {
    const token = process.env.CWE_API_TOKEN;
    if (!token) return true;
    return request.headers.authorization === `Bearer ${token}`;
  }

  private readJson(request: IncomingMessage): Promise<JsonRecord> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
        if (Buffer.concat(chunks).length > 1024 * 1024) {
          reject(new Error("REQUEST_TOO_LARGE"));
        }
      });
      request.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        if (!text) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(text) as JsonRecord);
        } catch {
          reject(new Error("INVALID_JSON"));
        }
      });
      request.on("error", reject);
    });
  }

  private send(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.statusCode = statusCode;
    if (payload === null) {
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(payload));
  }

  private serializeError(error: unknown): JsonRecord {
    if (isKuaishouPageActionError(error)) {
      return { ok: false, error: error.details };
    }
    const details = (error as { details?: unknown })?.details;
    if (details && typeof details === "object") {
      return { ok: false, error: details as JsonRecord };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: { code: message, message } };
  }
}
