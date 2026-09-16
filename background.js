// Handles deleting the data after an export.
// This has to live here and not in popup.js - Chrome kills the popup as soon
// as the save dialog opens, so a listener in the popup never fires and the
// emails just sit there. Took a while to figure out why.

const KEYS = ["sr_records", "sr_state"];

// downloadId -> tabId, so we know which tab to clear when it finishes
const tracked = new Map();

async function purgeEverywhere(tabId) {
  await chrome.storage.local.remove(KEYS).catch(() => {});
  if (tabId !== undefined && tabId !== null) {
    // storage isn't enough, the content script keeps its own copy in memory
    await chrome.tabs.sendMessage(tabId, { type: "SR_PURGE" }).catch(() => {});
  }
}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (!tracked.has(delta.id) || !delta.state) return;
  const tabId = tracked.get(delta.id);

  if (delta.state.current === "complete") {
    tracked.delete(delta.id);
    await purgeEverywhere(tabId);
  } else if (delta.state.current === "interrupted") {
    // don't delete on a cancelled download or you lose the whole run
    tracked.delete(delta.id);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg && msg.type === "SR_TRACK_DOWNLOAD") {
    tracked.set(msg.downloadId, msg.tabId ?? sender.tab?.id ?? null);
    respond({ ok: true });
    return false;
  }
  if (msg && msg.type === "SR_PURGE_NOW") {
    purgeEverywhere(msg.tabId).then(() => respond({ ok: true }));
    return true;
  }
  return false;
});

// clear on restart too, nothing should stick around between sessions
chrome.runtime.onStartup.addListener(() => chrome.storage.local.remove(KEYS));
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.remove(KEYS));
