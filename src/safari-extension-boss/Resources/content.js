const CONFIG = {
  keywords: [
    "c++",
    "cpp",
    "python",
    "鸿蒙",
    "harmonyos",
    "安卓",
    "android",
    "swift",
    "前端",
    "react",
    "webgl"
  ],
  minCompanySize: 500,
  delayMs: 1800
};

const STORAGE_KEY = "boss_greeter_handled_jobs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function getHandledJobs() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveHandledJob(jobKey) {
  const handledJobs = getHandledJobs();
  handledJobs.add(jobKey);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...handledJobs]));
}

function parseCompanySize(text) {
  const normalized = normalizeText(text);

  if (normalized.includes("10000人以上")) return 10000;
  if (normalized.includes("5000-10000人")) return 5000;
  if (normalized.includes("1000-9999人")) return 1000;
  if (normalized.includes("500-999人")) return 500;
  if (normalized.includes("500-1000人")) return 500;
  if (normalized.includes("1000人以上")) return 1000;

  const match = normalized.match(/(\d+)\s*-\s*(\d+)\s*人/);
  if (match) return Number(match[1]);

  const aboveMatch = normalized.match(/(\d+)\s*人以上/);
  if (aboveMatch) return Number(aboveMatch[1]);

  return 0;
}

function isDeveloperJob(text) {
  const normalized = normalizeText(text);
  return CONFIG.keywords.some((keyword) =>
    normalized.includes(keyword.toLowerCase())
  );
}

function getJobCards() {

  const selectors = [

    ".job-card-wrapper",

    ".job-card-box",

    ".job-list-box li",

    ".job-list-container li",

    ".search-job-result li",

    ".job-primary",

    "[ka*='search_list']",

    "li"

  ];

  const cards = selectors.flatMap((selector) => [

    ...document.querySelectorAll(selector)

  ]);

  return [...new Set(cards)].filter((card) => {

    const text = normalizeText(card.innerText);

    return (

      text.length > 30 &&

      (

        text.includes("立即沟通") ||

        text.includes("薪") ||

        text.includes("经验") ||

        text.includes("人") ||

        text.includes("公司")

      )

    );

  });

}

function getJobKey(card) {
  const link = card.querySelector("a[href]");
  return link?.href || normalizeText(card.innerText).slice(0, 180);
}



function isMatchedJob(card) {

  const text = card.innerText || "";

  const normalized = normalizeText(text);

  const size = parseCompanySize(text);

  const devMatched = isDeveloperJob(text);

  console.log("[boss-safari-bridge] card text:", normalized.slice(0, 300));

  console.log("[boss-safari-bridge] devMatched:", devMatched, "size:", size);

  return devMatched && size >= CONFIG.minCompanySize;

}

function highlightMatchedJobs() {

  const handledJobs = getHandledJobs();

  const cards = getJobCards();

  let matchedCount = 0;
    
  console.log("[boss-safari-bridge] found cards:", cards.length);

  for (const card of cards) {

    const jobKey = getJobKey(card);

    const matched = isMatchedJob(card) && !handledJobs.has(jobKey);

    if (matched) {

      matchedCount += 1;

      card.style.outline = "3px solid #18a058";

      card.style.borderRadius = "8px";

      card.dataset.bossGreeterMatched = "true";

    } else {

      card.style.outline = "";

      delete card.dataset.bossGreeterMatched;

    }

  }

  alert(`扫描到 ${cards.length} 个岗位卡片，找到 ${matchedCount} 个匹配岗位`);

}

function findButtonByText(textList) {
  const buttons = [...document.querySelectorAll("button, a, div, span")];

  return buttons.find((element) => {
    const text = normalizeText(element.innerText || element.textContent);
    return textList.some((target) => text === normalizeText(target));
  });
}

async function clickStayOnCurrentPageIfExists() {
  await sleep(800);

  const stayButton = findButtonByText([
    "留在当前页面",
    "留在当前页",
    "继续留在当前页面"
  ]);

  if (stayButton) {
    stayButton.click();
    return true;
  }

  return false;
}

async function greetOneJob(card) {
  const jobKey = getJobKey(card);

  card.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  await sleep(600);
  card.click();
  await sleep(1200);

  const chatButton = findButtonByText([
    "立即沟通",
    "继续沟通",
    "打招呼"
  ]);

  if (!chatButton) return false;

  chatButton.click();
  await clickStayOnCurrentPageIfExists();

  saveHandledJob(jobKey);
  return true;
}

async function startGreeting(limit) {
  highlightMatchedJobs();

  const cards = getJobCards().filter((card) => card.dataset.bossGreeterMatched === "true");
  let successCount = 0;

  for (const card of cards.slice(0, limit)) {
    const ok = await greetOneJob(card);

    if (ok) {
      successCount += 1;
    }

    await sleep(CONFIG.delayMs);
  }

  alert(`本次完成 ${successCount} 个打招呼`);
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type === "SCAN_JOBS") {
    highlightMatchedJobs();
  }

  if (message.type === "START_GREETING") {
    startGreeting(Number(message.limit || 10));
  }
});
