import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { KuaishouUploadAdapter } from "../video-upload/kuaishou/KuaishouUploadAdapter";
import { isKuaishouPageActionError } from "../video-upload/kuaishou/KuaishouPageBinding";
import type {
  KuaishouFormState,
  KuaishouOptionField,
  KuaishouUploadTaskInput,
  KuaishouWebEditableField,
  KuaishouWebEditableFields
} from "../video-upload/types";

type JsonRecord = Record<string, unknown>;

const WEB_EDITABLE_FIELDS: KuaishouWebEditableField[] = [
  "caption",
  "pkCoverEnabled",
  "chaptersText",
  "authorServiceType",
  "linkedBenefit",
  "hotspot",
  "authorStatement",
  "collectionName",
  "locationRegion",
  "locationAddress",
  "allowSameFrame",
  "allowDownload",
  "showInNearby",
  "visibility",
  "publishTimingMode",
  "scheduledPublishTime",
  "useBestTimeSuggestion"
];

const OPTION_FIELDS: KuaishouOptionField[] = [
  "authorServiceType",
  "linkedBenefit",
  "hotspot",
  "authorStatement",
  "collectionName",
  "locationRegion",
  "locationAddress"
];

export class KuaishouLocalApiServer {
  private server: Server | null = null;

  constructor(private readonly adapter: KuaishouUploadAdapter) {}

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

      if (method === "GET" && url.pathname === "/api/health") {
        this.send(response, 200, { ok: true, service: "crawl-web-electron", platform: "kuaishou" });
        return;
      }

      if (method === "POST" && url.pathname === "/api/kuaishou/open-upload-page") {
        await this.adapter.openUploadPage();
        this.send(response, 200, { ok: true });
        return;
      }

      if (method === "GET" && url.pathname === "/api/kuaishou/detection") {
        this.send(response, 200, { ok: true, data: await this.adapter.detectPage() });
        return;
      }

      if (method === "GET" && url.pathname === "/api/kuaishou/page-state") {
        this.send(response, 200, { ok: true, data: await this.adapter.readPageState() });
        return;
      }

      if (method === "POST" && url.pathname === "/api/kuaishou/options") {
        const body = await this.readJson(request);
        const field = body.field;
        if (!this.isOptionField(field)) {
          this.send(response, 400, { ok: false, error: { code: "INVALID_FIELD", message: "Unsupported option field" } });
          return;
        }
        const query = typeof body.query === "string" ? body.query : "";
        this.send(response, 200, { ok: true, data: await this.adapter.readOptions(field, query) });
        return;
      }

      if (method === "POST" && url.pathname === "/api/kuaishou/apply-settings") {
        const body = await this.readJson(request);
        const settings = this.objectBody(body.settings);
        const dirtyFields = this.normalizeDirtyFields(body.dirtyFields, settings);
        this.send(response, 200, {
          ok: true,
          data: await this.adapter.applyFormState(this.settingsToFormState(settings, dirtyFields))
        });
        return;
      }

      if (method === "POST" && url.pathname === "/api/kuaishou/upload-single") {
        const body = await this.readJson(request);
        const settings = this.objectBody(body.settings);
        const validationError = this.validateUploadSingle(body, settings);
        if (validationError) {
          this.send(response, 400, { ok: false, error: validationError });
          return;
        }

        const input = this.uploadInputFromBody(body, settings);
        let result = await this.adapter.uploadSingleVideo(input);

        if (body.confirmPublish === true && result.ok && result.status === "waiting_publish_confirm") {
          result = await this.adapter.confirmPublish(result.taskId);
        }

        if (body.confirmPublish === true && result.ok && result.status === "published") {
          try {
            await this.adapter.prepareForNextUploadTask();
          } catch (error) {
            console.warn("[api:kuaishou] published task but failed to prepare next upload page", {
              taskId: result.taskId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        this.send(response, 200, { ok: result.ok, data: result });
        return;
      }

      const taskMatch = url.pathname.match(/^\/api\/kuaishou\/tasks\/([^/]+)$/);
      if (method === "GET" && taskMatch) {
        const task = this.adapter.getTask(decodeURIComponent(taskMatch[1]));
        this.send(response, task ? 200 : 404, task ? { ok: true, data: task } : { ok: false, error: { code: "TASK_NOT_FOUND", message: "Task not found" } });
        return;
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

  private objectBody(value: unknown): JsonRecord {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
  }

  private normalizeDirtyFields(value: unknown, settings: JsonRecord): KuaishouWebEditableField[] {
    if (Array.isArray(value)) {
      return value.filter((field): field is KuaishouWebEditableField => WEB_EDITABLE_FIELDS.includes(field as KuaishouWebEditableField));
    }

    const dirtyFields = WEB_EDITABLE_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(settings, field));
    if (settings.scheduledPublishTime !== undefined && !dirtyFields.includes("publishTimingMode")) {
      dirtyFields.push("publishTimingMode");
    }
    return dirtyFields;
  }

  private settingsToFormState(settings: JsonRecord, dirtyFields: KuaishouWebEditableField[]): KuaishouFormState {
    return {
      videoPath: "",
      coverPath: "",
      caption: this.stringValue(settings.caption),
      pkCoverEnabled: this.optionalBoolean(settings.pkCoverEnabled),
      chaptersText: this.stringValue(settings.chaptersText),
      authorServiceType: this.stringValue(settings.authorServiceType),
      linkedBenefit: this.stringValue(settings.linkedBenefit),
      hotspot: this.stringValue(settings.hotspot),
      authorStatement: this.stringValue(settings.authorStatement),
      collectionName: this.stringValue(settings.collectionName),
      locationRegion: this.stringValue(settings.locationRegion),
      locationAddress: this.stringValue(settings.locationAddress),
      allowSameFrame: this.booleanValue(settings.allowSameFrame, true),
      allowDownload: this.booleanValue(settings.allowDownload, true),
      showInNearby: this.booleanValue(settings.showInNearby, true),
      visibility: settings.visibility === "friends" || settings.visibility === "private" ? settings.visibility : "public",
      publishTimingMode: settings.publishTimingMode === "scheduled" ? "scheduled" : "immediate",
      scheduledPublishTime: this.stringValue(settings.scheduledPublishTime),
      useBestTimeSuggestion: this.booleanValue(settings.useBestTimeSuggestion, false),
      publishMode: "manual_confirm",
      dirtyFields,
      lastUpdatedBy: "task",
      updatedAt: Date.now()
    };
  }

  private validateUploadSingle(body: JsonRecord, settings: JsonRecord): { code: string; message: string } | null {
    if (typeof body.videoPath !== "string" || body.videoPath.length === 0) {
      return { code: "VIDEO_PATH_REQUIRED", message: "videoPath is required" };
    }
    if (typeof settings.caption !== "string" || settings.caption.trim().length === 0) {
      return { code: "CAPTION_REQUIRED", message: "settings.caption is required" };
    }
    if (typeof settings.collectionName !== "string" || settings.collectionName.trim().length === 0) {
      return { code: "COLLECTION_REQUIRED", message: "settings.collectionName is required" };
    }
    if (typeof settings.showInNearby !== "boolean") {
      return { code: "SHOW_IN_NEARBY_REQUIRED", message: "settings.showInNearby must be boolean" };
    }
    if (settings.publishTimingMode !== "scheduled") {
      return { code: "SCHEDULED_MODE_REQUIRED", message: "settings.publishTimingMode must be scheduled" };
    }
    if (typeof settings.scheduledPublishTime !== "string" || !/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(settings.scheduledPublishTime.trim())) {
      return { code: "SCHEDULED_TIME_REQUIRED", message: "settings.scheduledPublishTime must use YYYY-MM-DD HH:mm" };
    }
    return null;
  }

  private uploadInputFromBody(body: JsonRecord, settings: JsonRecord): KuaishouUploadTaskInput {
    const dirtyFields = this.normalizeDirtyFields(body.dirtyFields, settings);
    for (const required of ["caption", "collectionName", "showInNearby", "publishTimingMode", "scheduledPublishTime"] as KuaishouWebEditableField[]) {
      if (!dirtyFields.includes(required)) dirtyFields.push(required);
    }

    return {
      platform: "kuaishou",
      accountId: typeof body.accountId === "string" ? body.accountId : "default-kuaishou",
      videoPath: String(body.videoPath),
      caption: this.stringValue(settings.caption),
      coverPath: typeof body.coverPath === "string" && body.coverPath.length > 0 ? body.coverPath : undefined,
      pkCoverEnabled: this.optionalBoolean(settings.pkCoverEnabled),
      chaptersText: this.optionalString(settings.chaptersText),
      authorServiceType: this.optionalString(settings.authorServiceType),
      linkedBenefit: this.optionalString(settings.linkedBenefit),
      hotspot: this.optionalString(settings.hotspot),
      authorStatement: this.optionalString(settings.authorStatement),
      collectionName: this.optionalString(settings.collectionName),
      locationRegion: this.optionalString(settings.locationRegion),
      locationAddress: this.optionalString(settings.locationAddress),
      allowSameFrame: this.optionalBoolean(settings.allowSameFrame),
      allowDownload: this.optionalBoolean(settings.allowDownload),
      showInNearby: this.optionalBoolean(settings.showInNearby),
      visibility: settings.visibility === "friends" || settings.visibility === "private" ? settings.visibility : settings.visibility === "public" ? "public" : undefined,
      publishTimingMode: settings.publishTimingMode === "scheduled" ? "scheduled" : settings.publishTimingMode === "immediate" ? "immediate" : undefined,
      scheduledPublishTime: this.optionalString(settings.scheduledPublishTime),
      useBestTimeSuggestion: this.optionalBoolean(settings.useBestTimeSuggestion),
      publishMode: "manual_confirm",
      timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
      dirtyFields,
      uploadIntent:
        body.uploadIntent === "continue_current" ? "continue_current" : body.uploadIntent === "current_intake" ? "current_intake" : "new_video",
      draftPolicy: body.draftPolicy === "continue" ? "continue" : "pause"
    };
  }

  private serializeError(error: unknown): JsonRecord {
    if (isKuaishouPageActionError(error)) {
      return { ok: false, error: error.details };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: { code: message, message } };
  }

  private isOptionField(value: unknown): value is KuaishouOptionField {
    return typeof value === "string" && OPTION_FIELDS.includes(value as KuaishouOptionField);
  }

  private stringValue(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private booleanValue(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
  }

  private optionalBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
  }
}
