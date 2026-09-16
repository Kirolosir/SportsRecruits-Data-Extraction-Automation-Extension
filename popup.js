// The popup. Messages the content script for the data, builds the spreadsheet
// here, then clears everything once it's saved.

const $ = (id) => document.getElementById(id);
// localhost is the test server in test-harness/. Take it out of here and out
// of manifest.json before giving this to anyone.
const SR_HOST = /(^|\.)sports?recruits\.com$|^localhost$/i;

let activeTabId = null;
let lastStats = { total: 0, withEmail: 0, withIg: 0, running: false, target: 1000 };

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text || "";
  el.className = "status" + (kind ? " " + kind : "");
}

function render(s) {
  lastStats = { ...lastStats, ...s };
  $("count").textContent = s.total ?? 0;
  $("withEmail").textContent = s.withEmail ?? 0;
  $("withIg").textContent = s.withIg ?? 0;

  const target = s.target || Number($("target").value) || 1;
  $("bar").style.width = Math.min(100, ((s.total || 0) / target) * 100) + "%";

  $("start").textContent = s.running ? "Stop" : "Start collecting";
  $("export").disabled = !s.total || s.running;
  $("purge").style.visibility = s.total ? "block" : "hidden";
  $("details").classList.toggle("hidden", !(s.hasDetailTemplate && s.total && !s.running));

  if (s.note) setStatus(s.note, s.running ? "" : "ok");
}

function send(msg) {
  return chrome.tabs.sendMessage(activeTabId, msg).catch(() => null);
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  activeTabId = tab.id;

  let host = "";
  try { host = new URL(tab.url).hostname; } catch (_) {}

  if (!SR_HOST.test(host)) {
    setStatus("Open a SportsRecruits search page first, then click here again.", "warn");
    $("start").disabled = true;
    $("purge").style.visibility = "hidden";
    return;
  }

  const stats = await send({ type: "SR_STATUS" });
  if (!stats) {
    setStatus("Reload the SportsRecruits tab, then try again.", "warn");
    $("start").disabled = true;
    return;
  }
  if (stats.target) $("target").value = stats.target;
  render(stats);
}

// content script sends progress updates while it runs
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "SR_STATUS" && msg.stats) render(msg.stats);
});

$("start").addEventListener("click", async () => {
  if (lastStats.running) {
    render(await send({ type: "SR_STOP" }));
    return;
  }
  const target = Math.max(1, Number($("target").value) || 1000);
  setStatus("Starting - leave this tab open.", "");
  render(await send({ type: "SR_START", target }));
});

$("details").addEventListener("click", async () => {
  setStatus("Pulling profile details...", "");
  render(await send({ type: "SR_DETAILS" }));
});

$("purge").addEventListener("click", async () => {
  if (!confirm("Delete all collected recruits? This cannot be undone.")) return;
  const s = await send({ type: "SR_PURGE" });
  render(s || { total: 0, withEmail: 0, withIg: 0, running: false });
  setStatus("All collected data deleted.", "ok");
});

$("export").addEventListener("click", async () => {
  $("export").disabled = true;
  setStatus("Building spreadsheet...", "");

  const data = await send({ type: "SR_DATA" });
  const records = (data && data.records) || [];
  if (!records.length) {
    setStatus("Nothing collected yet.", "warn");
    $("export").disabled = false;
    return;
  }

  let url;
  try {
    const sheets = SRSheet.buildSheets(records);
    const bytes = SRXlsx.buildXlsx(sheets);
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    url = URL.createObjectURL(blob);

    const stamp = new Date().toISOString().slice(0, 10);
    const downloadId = await chrome.downloads.download({
      url,
      filename: `recruits-${stamp}.xlsx`,
      saveAs: true,
    });

    // tell background.js first - the save dialog can close this popup and then
    // nothing down here runs
    await chrome.runtime.sendMessage({
      type: "SR_TRACK_DOWNLOAD", downloadId, tabId: activeTabId,
    }).catch(() => {});

    setStatus("Saving...", "");
    await waitForDownload(downloadId);

    // Chrome already has the file so it's fine to delete our copy now
    await send({ type: "SR_PURGE" });
    render({ total: 0, withEmail: 0, withIg: 0, running: false });
    setStatus(`Saved ${records.length} recruits. Collected data deleted.`, "ok");
  } catch (err) {
    setStatus("Export failed: " + (err && err.message ? err.message : String(err)), "warn");
    $("export").disabled = false;
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
});

/** Waits for the download to actually finish. */
function waitForDownload(id) {
  return new Promise((resolve, reject) => {
    const done = (ok, err) => {
      chrome.downloads.onChanged.removeListener(onChanged);
      clearTimeout(timer);
      ok ? resolve() : reject(new Error(err));
    };
    const onChanged = (delta) => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === "complete") done(true);
      if (delta.state.current === "interrupted") done(false, "download cancelled");
    };
    chrome.downloads.onChanged.addListener(onChanged);
    // timeout so the UI doesn't hang forever if the event never comes
    const timer = setTimeout(() => done(true), 20000);
  });
}

init();
