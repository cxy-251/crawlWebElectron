async function sendCommand(type) {
  const limit = Number(document.getElementById("limit").value || 10);

  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  await browser.tabs.sendMessage(tab.id, {
    type,
    limit
  });
}

document.getElementById("scan").addEventListener("click", () => {
  sendCommand("SCAN_JOBS");
});

document.getElementById("start").addEventListener("click", () => {
  sendCommand("START_GREETING");
});
