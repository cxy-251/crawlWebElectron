import fs from "node:fs";
import path from "node:path";
import {
  COLLECTION_NAME,
  DAILY_SLOTS,
  SCHEDULE_START_AT,
  SHOW_IN_NEARBY,
  SONGS_META_DIR,
  SONGS_OUT_DIR,
  TASKS_FILE
} from "./constants.mjs";

function main() {
  const videoFiles = fs
    .readdirSync(SONGS_OUT_DIR)
    .filter((file) => file.toLowerCase().endsWith(".mp4"))
    .sort((a, b) => a.localeCompare(b, "en"));

  const tasks = videoFiles.map((file, index) => {
    const videoName = file.replace(/\.mp4$/i, "");
    const metaPath = path.join(SONGS_META_DIR, videoName, "render-input.json");
    const meta = readJson(metaPath);
    const scheduledPublishTime = scheduleAt(index);

    return {
      videoPath: path.join(SONGS_OUT_DIR, file),
      settings: {
        caption: captionFrom(meta, videoName),
        collectionName: COLLECTION_NAME,
        showInNearby: SHOW_IN_NEARBY,
        publishTimingMode: "scheduled",
        scheduledPublishTime
      },
      confirmPublish: true,
      uploadIntent: "new_video",
      draftPolicy: "pause"
    };
  });

  fs.writeFileSync(TASKS_FILE, `${JSON.stringify(tasks, null, 2)}\n`);
  console.log(`Generated ${tasks.length} tasks: ${TASKS_FILE}`);
  if (tasks.length > 0) {
    console.log(`First scheduled time: ${tasks[0].settings.scheduledPublishTime}`);
    console.log(`Last scheduled time: ${tasks[tasks.length - 1].settings.scheduledPublishTime}`);
  }
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing metadata file: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function captionFrom(meta, fallbackName) {
  const lines = meta?.poetryFrame?.sonnetLines;
  if (Array.isArray(lines) && lines.length > 0) {
    return lines.slice(0, 4).join("\n");
  }

  const bottomLine = meta?.poetryFrame?.bottomLine;
  if (typeof bottomLine === "string" && bottomLine.trim()) {
    return bottomLine.trim();
  }

  const titleArtist = [meta?.title, meta?.artist].filter(Boolean).join(" - ");
  return titleArtist || fallbackName;
}

function scheduleAt(index) {
  const start = parseScheduleStart();
  const slotIndex = DAILY_SLOTS.indexOf(start.time);
  const slotCount = DAILY_SLOTS.length;
  const absoluteSlot = slotIndex + index;
  const dayOffset = Math.floor(absoluteSlot / slotCount);
  const slot = DAILY_SLOTS[absoluteSlot % slotCount];
  const date = new Date(start.year, start.month - 1, start.day + dayOffset);
  return `${formatDate(date)} ${slot}`;
}

function parseScheduleStart() {
  const match = String(SCHEDULE_START_AT || "").match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})$/);
  if (!match) {
    throw new Error("SCHEDULE_START_AT must use YYYY-MM-DD HH:mm");
  }

  if (DAILY_SLOTS.length === 0) {
    throw new Error("DAILY_SLOTS cannot be empty");
  }

  for (const slot of DAILY_SLOTS) {
    if (!/^\d{2}:\d{2}$/.test(slot)) {
      throw new Error(`Invalid slot: ${slot}`);
    }
  }

  const time = match[4];
  if (!DAILY_SLOTS.includes(time)) {
    throw new Error(`SCHEDULE_START_AT time must be one of DAILY_SLOTS: ${DAILY_SLOTS.join(", ")}`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    time
  };
}

function formatDate(date) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

main();
