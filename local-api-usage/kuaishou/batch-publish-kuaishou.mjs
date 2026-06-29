import fs from "node:fs";
import { API_BASE_URL, API_TOKEN, STATE_FILE, TASKS_FILE } from "./constants.mjs";

async function main() {
  const tasks = JSON.parse(fs.readFileSync(TASKS_FILE, "utf8"));
  if (!Array.isArray(tasks)) {
    throw new Error("Tasks file must contain a JSON array");
  }

  const state = readState();
  for (const [index, task] of tasks.entries()) {
    const key = task.videoPath || String(index);

    if (index > 0) {
      await prepareUploadPageForNextTask(index + 1, tasks.length);
    }

    console.log(`[run] ${index + 1}/${tasks.length}: ${key}`);
    state[key] = { status: "running", startedAt: new Date().toISOString() };
    writeState(state);

    const result = await postJson("/api/kuaishou/upload-single", task);
    const data = result.data;
    state[key] = {
      status: data?.status || (result.ok ? "done" : "failed"),
      ok: Boolean(result.ok),
      taskId: data?.taskId,
      error: result.error || data?.error,
      updatedAt: new Date().toISOString()
    };
    writeState(state);

    if (!result.ok || data?.status !== "published") {
      console.error(`[pause] ${key}`);
      console.error(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }

    state[key].status = "published";
    writeState(state);
    console.log(`[ok] published: ${key}`);
  }
}

async function postJson(path, body) {
  const headers = { "Content-Type": "application/json" };
  if (API_TOKEN) {
    headers.Authorization = `Bearer ${API_TOKEN}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    return { ok: false, error: json.error || { code: response.status, message: response.statusText } };
  }
  return json;
}

async function getJson(path) {
  const headers = {};
  if (API_TOKEN) {
    headers.Authorization = `Bearer ${API_TOKEN}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { headers });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    return { ok: false, error: json.error || { code: response.status, message: response.statusText } };
  }
  return json;
}

async function prepareUploadPageForNextTask(index, total) {
  console.log(`[prepare] ${index}/${total}: opening upload page for next task`);
  const opened = await postJson("/api/kuaishou/open-upload-page", {});
  if (!opened.ok) {
    throw new Error(`Failed to open upload page: ${JSON.stringify(opened)}`);
  }

  const detection = await waitForDetection((data) => isKnownUploadSurface(data), {
    timeoutMs: 60000,
    intervalMs: 750,
    settleMs: 300
  });
  console.log(
    `[prepare] ready: pageType=${detection.pageType} fileInput=${Boolean(detection.capabilities?.hasFileInput)} uploadEntry=${Boolean(
      detection.capabilities?.hasUploadEntryButton
    )} editable=${Boolean(detection.capabilities?.hasEditableContent)}`
  );
}

async function waitForDetection(predicate, { timeoutMs, intervalMs, settleMs }) {
  const startedAt = Date.now();
  let lastDetection = null;

  while (Date.now() - startedAt < timeoutMs) {
    const response = await getJson("/api/kuaishou/detection");
    if (response.ok && response.data) {
      lastDetection = response.data;
      if (predicate(lastDetection)) {
        await sleep(settleMs);
        const settled = await getJson("/api/kuaishou/detection");
        return settled.ok && settled.data ? settled.data : lastDetection;
      }
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for upload page state: ${JSON.stringify(summarizeDetection(lastDetection))}`);
}

function isKnownUploadSurface(detection) {
  const capabilities = detection?.capabilities || {};
  return Boolean(
    capabilities.loginRequired ||
      capabilities.hasDraftContinueButton ||
      capabilities.hasUploadEntryButton ||
      capabilities.hasFileInput ||
      capabilities.hasEditableContent ||
      capabilities.hasUploadProgress
  );
}

function summarizeDetection(detection) {
  if (!detection) return null;
  const capabilities = detection.capabilities || {};
  return {
    pageType: detection.pageType,
    url: detection.url,
    capabilities: {
      loginRequired: capabilities.loginRequired,
      hasDraftContinueButton: capabilities.hasDraftContinueButton,
      hasUploadEntryButton: capabilities.hasUploadEntryButton,
      hasFileInput: capabilities.hasFileInput,
      hasUploadProgress: capabilities.hasUploadProgress,
      hasEditableContent: capabilities.hasEditableContent
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
