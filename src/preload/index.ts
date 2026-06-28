import { contextBridge, ipcRenderer } from "electron";
import type { AppApi } from "./appApi";

const appApi: AppApi = {
  browser: {
    async goto(url: string): Promise<void> {
      await ipcRenderer.invoke("browser:goto", url);
    },
    async reload(): Promise<void> {
      await ipcRenderer.invoke("browser:reload");
    },
    async getState(): Promise<{ url: string; title: string }> {
      return ipcRenderer.invoke("browser:get-state");
    }
  },
  tools: {
    async listTools() {
      return ipcRenderer.invoke("tools:list-tools");
    }
  },
  workflows: {
    async listWorkflows() {
      return ipcRenderer.invoke("workflows:list");
    },
    async checkService(workflowId) {
      return ipcRenderer.invoke("workflows:check-service", workflowId);
    },
    async getRuntimeSnapshot(workflowId) {
      return ipcRenderer.invoke("workflows:runtime-snapshot", workflowId);
    },
    async getRunDetail(workflowId, runId) {
      return ipcRenderer.invoke("workflows:run-detail", workflowId, runId);
    }
  },
  kuaishou: {
    async openHome(): Promise<void> {
      await ipcRenderer.invoke("kuaishou:open-home");
    },
    async openUploadPage() {
      return ipcRenderer.invoke("kuaishou:open-upload-page");
    },
    async continueEditingOrStartNewUpload() {
      return ipcRenderer.invoke("kuaishou:continue-editing-or-start-new-upload");
    },
    async detectPage() {
      return ipcRenderer.invoke("kuaishou:detect-page");
    },
    async diagnoseDom() {
      return ipcRenderer.invoke("kuaishou:diagnose-dom");
    },
    async captureDiagnosticEvidence() {
      return ipcRenderer.invoke("kuaishou:capture-diagnostic-evidence");
    },
    async readPageState() {
      return ipcRenderer.invoke("kuaishou:read-page-state");
    },
    async getOptions(field, query) {
      return ipcRenderer.invoke("kuaishou:get-options", field, query);
    },
    async applyFormState(state) {
      return ipcRenderer.invoke("kuaishou:apply-form-state", state);
    },
    async pickLocalFile(kind) {
      return ipcRenderer.invoke("kuaishou:pick-local-file", kind);
    },
    async uploadSingleVideo(input) {
      return ipcRenderer.invoke("kuaishou:upload-single-video", input);
    },
    async confirmPublish(taskId) {
      return ipcRenderer.invoke("kuaishou:confirm-publish", taskId);
    },
    async cancelTask(taskId) {
      return ipcRenderer.invoke("kuaishou:cancel-task", taskId);
    },
    async getElementProfile() {
      return ipcRenderer.invoke("kuaishou:get-element-profile");
    },
    async updateElementProfile(profile) {
      return ipcRenderer.invoke("kuaishou:update-element-profile", profile);
    },
    async resetElementProfile() {
      return ipcRenderer.invoke("kuaishou:reset-element-profile");
    },
    async testElement(locatorKey) {
      return ipcRenderer.invoke("kuaishou:test-element", locatorKey);
    },
    async getTask(taskId) {
      return ipcRenderer.invoke("kuaishou:get-task", taskId);
    },
    async getTaskLogs(taskId) {
      return ipcRenderer.invoke("kuaishou:get-task-logs", taskId);
    }
  }
};

contextBridge.exposeInMainWorld("appApi", appApi);
