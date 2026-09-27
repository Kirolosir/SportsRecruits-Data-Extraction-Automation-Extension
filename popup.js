// The popup. Messages the content script for the data, builds the spreadsheet
// here, then clears everything once it's saved.

const $ = (id) => document.getElementById(id);

// Theme uses an external script, as required by Manifest V3.
function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try { localStorage.setItem("sr_theme", dark ? "dark" : "light"); } catch (e) {}
}
// localhost is the test server in test-harness/. Take it out of here and out
// of manifest.json before giving this to anyone.
const SR_HOST = /(^|\.)sports?recruits\.com$|^localhost$/i;

let activeTabId = null;
let stopInProgress = false;
let lastStats = { total: 0, withEmail: 0, withIg: 0, running: false, target: 500, supportsBatchLimit: false };

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text || "";
  el.className = "status" + (kind ? " " + kind : "");
}

const RELOAD_MESSAGE = "Reload the extension and SportsRecruits tab to load the current batch settings. Stop/export any current run first.";

function render(s) {
  if (!s) { setStatus("Could not contact the tab. Reload it and try again.", "warn"); return; }
  lastStats = { ...lastStats, ...s };
  $("count").textContent = s.total ?? 0;
  $("withEmail").textContent = s.withEmail ?? 0;
  $("withIg").textContent = s.withIg ?? 0;

  const target = s.target || 500;
  const outdated = lastStats.supportsBatchLimit !== true;
  $("target").disabled = !!s.running || outdated;
  if (s.running) $("target").value = String(target);
  const progress = s.phase === "details" ? (s.detailsDone || 0) / Math.max(1, s.total || 0) : (s.total || 0) / target;
  $("bar").style.width = Math.min(100, progress * 100) + "%";
  $("bar").classList.toggle("running", !!s.running);

  $("start").textContent = stopInProgress ? "Stopping…" : s.running ? "Stop" : "Start collecting";
  $("start").disabled = stopInProgress || (outdated && !s.running);
  $("export").disabled = stopInProgress || !s.total || s.running;
  $("purge").classList.toggle("hidden", !s.total);
  $("resume").classList.toggle("hidden", stopInProgress || !s.total || s.running || !lastStats.supportsProfileResume);

  if (stopInProgress) { setStatus("Stopping and keeping collected athletes…", ""); return; }
  if (outdated) { setStatus(RELOAD_MESSAGE, "warn"); return; }
  if (s.note) setStatus(s.note, s.running ? "" : /[1-9]\d* failed|stopped|only/i.test(s.note) ? "warn" : "ok");
}

function send(msg, timeout = 2500) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeout);
    chrome.tabs.sendMessage(activeTabId, msg, { frameId: 0 }).then(result => {
      clearTimeout(timer); resolve(result);
    }).catch(() => { clearTimeout(timer); resolve(null); });
  });
}

$("target").addEventListener("change", () => {
  const target = Number($("target").value);
  if (!lastStats.running && Number.isInteger(target) && target >= 1 && target <= 10000) {
    try { localStorage.setItem("sr_target", String(target)); } catch (_) {}
  }
});

async function init() {
  try { $("target").value = localStorage.getItem("sr_target") || "500"; } catch (_) {}
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  activeTabId = tab.id;

  let host = "";
  try { host = new URL(tab.url).hostname; } catch (_) {}

  if (!SR_HOST.test(host)) {
    setStatus("Open a SportsRecruits search page first, then click here again.", "warn");
    $("start").disabled = true;
    $("purge").classList.add("hidden");
    return;
  }

  let stats = await send({ type: "SR_STATUS" });
  if (!stats) stats = await chrome.runtime.sendMessage({type: "SR_LAST_STATUS", tabId: activeTabId}).catch(() => null);
  if (!stats) {
    setStatus("Reload the SportsRecruits tab, then try again.", "warn");
    $("start").disabled = true;
    return;
  }
  render(stats);
}

// content script sends progress updates while it runs
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.tab?.id === activeTabId && sender.frameId === 0 && msg && msg.type === "SR_STATUS" && msg.stats) render(msg.stats);
});

$("start").addEventListener("click", async () => {
  if (stopInProgress) return;
  if (lastStats.running) {
    stopInProgress = true;
    $("start").disabled = true;
    $("start").textContent = "Stopping…";
    setStatus("Stopping and keeping collected athletes…", "");
    const result = await chrome.runtime.sendMessage({type: "SR_STOP_REQUEST", tabId: activeTabId}).catch(() => null);
    stopInProgress = false;
    if (!result?.ok) {
      $("start").disabled = false; $("start").textContent = "Stop";
      setStatus("Could not stop the tab. Saved results are retained.", "warn"); return;
    }
    if (result.stats) render(result.stats);
    else {
      const restored = await send({type: "SR_STATUS" });
      render(restored || {...lastStats, total: result.total, running:false, note:result.note});
    }
    return;
  }
  if (lastStats.supportsBatchLimit !== true) { setStatus(RELOAD_MESSAGE, "warn"); return; }
  setStatus("Starting - leave this tab open.", "");
  const target = Number($("target").value);
  if (!Number.isInteger(target) || target < 1 || target > 10000) {
    setStatus("Choose a whole number from 1 to 10,000 athletes.", "warn"); return;
  }
  try { localStorage.setItem("sr_target", String(target)); } catch (_) {}
  render(await send({ type: "SR_START", target }));
});

$("resume").addEventListener("click", async () => {
  if (lastStats.running || !lastStats.supportsProfileResume) return;
  setStatus("Collecting emails for the athletes already found...", "");
  render(await send({ type: "SR_RESUME_PROFILES" }));
});

$("purge").addEventListener("click", async () => {
  if (!confirm("Delete all collected recruits? This cannot be undone.")) return;
  const deleted = await chrome.runtime.sendMessage({ type: "SR_PURGE_NOW", tabId: activeTabId }).catch(() => null);
  if (!deleted?.ok) { setStatus("Deletion failed. Try again.", "warn"); return; }
  const s = await send({ type: "SR_STATUS" });
  render(s || { total: 0, withEmail: 0, withIg: 0, running: false });
  setStatus("All collected data deleted.", "ok");
});

$("export").addEventListener("click", async () => {
  $("export").disabled = true;
  setStatus("Building spreadsheet...", "");

  const data = await send({ type: "SR_DATA" }, 15000);
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
    const tracking = await chrome.runtime.sendMessage({
      type: "SR_TRACK_DOWNLOAD", downloadId, tabId: activeTabId,
    });
    if (!tracking?.ok) throw new Error("Could not register deletion after saving. Collected data retained.");

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
    const timer = setTimeout(() => done(false, "Save still pending. Data retained until Chrome confirms completion."), 120000);
    // Cover completion/cancellation between download() and listener setup.
    chrome.downloads.search({ id }).then(([item]) => {
      if (item?.state === "complete") done(true);
      else if (item?.state === "interrupted") done(false, "download cancelled");
    }).catch(() => {});
  });
}

$("theme").addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme !== "dark");
});

try {
  const saved = localStorage.getItem("sr_theme");
  setTheme(saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
} catch (_) {}
init();
