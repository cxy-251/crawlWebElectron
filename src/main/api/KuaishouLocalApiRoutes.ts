import type { KuaishouUploadAdapter } from "../video-upload/kuaishou/KuaishouUploadAdapter";
import type {
  KuaishouFormState,
  KuaishouOptionField,
  KuaishouUploadTaskInput,
  KuaishouWebEditableField,
  KuaishouWebEditableFields
} from "../video-upload/types";
import type { JsonRecord, LocalApiRequest, LocalApiRouteResult } from "./LocalApiTypes";
import { routeHandled, routeNotHandled } from "./LocalApiTypes";

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

export class KuaishouLocalApiRoutes {
  constructor(private readonly adapter: KuaishouUploadAdapter) {}

  async handle({ request, method, url, readJson }: LocalApiRequest): Promise<LocalApiRouteResult> {
    if (method === "POST" && url.pathname === "/api/kuaishou/open-upload-page") {
      await this.adapter.openUploadPage();
      return routeHandled(200, { ok: true });
    }

    if (method === "GET" && url.pathname === "/api/kuaishou/detection") {
      return routeHandled(200, { ok: true, data: await this.adapter.detectPage() });
    }

    if (method === "GET" && url.pathname === "/api/kuaishou/page-state") {
      return routeHandled(200, { ok: true, data: await this.adapter.readPageState() });
    }

    if (method === "POST" && url.pathname === "/api/kuaishou/options") {
      const body = await readJson(request);
      const field = body.field;
      if (!this.isOptionField(field)) {
        return routeHandled(400, { ok: false, error: { code: "INVALID_FIELD", message: "Unsupported option field" } });
      }
      const query = typeof body.query === "string" ? body.query : "";
      return routeHandled(200, { ok: true, data: await this.adapter.readOptions(field, query) });
    }

    if (method === "POST" && url.pathname === "/api/kuaishou/apply-settings") {
      const body = await readJson(request);
      const settings = this.objectBody(body.settings);
      const dirtyFields = this.normalizeDirtyFields(body.dirtyFields, settings);
      return routeHandled(200, {
        ok: true,
        data: await this.adapter.applyFormState(this.settingsToFormState(settings, dirtyFields))
      });
    }

    if (method === "POST" && url.pathname === "/api/kuaishou/upload-single") {
      const body = await readJson(request);
      const settings = this.objectBody(body.settings);
      const validationError = this.validateUploadSingle(body, settings);
      if (validationError) {
        return routeHandled(400, { ok: false, error: validationError });
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

      return routeHandled(200, { ok: result.ok, data: result });
    }

    const taskMatch = url.pathname.match(/^\/api\/kuaishou\/tasks\/([^/]+)$/);
    if (method === "GET" && taskMatch) {
      const task = this.adapter.getTask(decodeURIComponent(taskMatch[1]));
      return routeHandled(
        task ? 200 : 404,
        task ? { ok: true, data: task } : { ok: false, error: { code: "TASK_NOT_FOUND", message: "Task not found" } }
      );
    }

    return routeNotHandled();
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
