// Handles deleting the data after an export.
// This has to live here and not in popup.js - Chrome kills the popup as soon
// as the save dialog opens, so a listener in the popup never fires and the
// emails just sit there. Took a while to figure out why.

const KEYS = ["sr_records", "sr_state"];

// Session storage survives MV3 worker suspension; no recruit data is stored here.
const downloadKey = (id) => "sr_download_" + id;

async function removeCollection() {
  const got = await chrome.storage.local.get(null);
  await chrome.storage.local.remove([...KEYS, ...Object.keys(got).filter(key => key.startsWith("sr_profile_"))]);
}

async function finishDownload(id, state) {
  const key = downloadKey(id);
  const got = await chrome.storage.session.get(key);
  if (!got[key]) return;
  if (state === "complete") {
    await purgeEverywhere(got[key].tabId);
    await chrome.storage.session.remove(key);
  } else if (state === "interrupted") await chrome.storage.session.remove(key);
}

async function purgeEverywhere(tabId) {
  await removeCollection();
  // Other top-frame instances may have restored the same local records.
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getManifest().content_scripts[0].matches }).catch(() => []);
  const ids = new Set(tabs.map((tab) => tab.id));
  if (tabId !== undefined && tabId !== null) ids.add(tabId);
  await Promise.all([...ids].map((id) => chrome.tabs.sendMessage(id, { type: "SR_PURGE" }, { frameId: 0 }).catch(() => {})));
}

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state) finishDownload(delta.id, delta.state.current).catch(() => {});
});

async function recoverStoppedTab(tabId) {
      const tab = await chrome.tabs.get(tabId);
      const host = new URL(tab.url).hostname;
      if (!/(^|\.)sports?recruits\.com$|^localhost$/i.test(host)) throw new Error("Wrong tab");
      // Browser-level reload terminates managed frames even if the site's
      // renderer cannot process messages. Completed profiles are checkpointed.
      await chrome.tabs.reload(tabId);
      const got = await chrome.storage.local.get(KEYS);
      const originals = got.sr_records || [];
      const details = originals.length ? await chrome.storage.local.get(originals.map(rec => "sr_profile_" + rec.key)) : {};
      const records = originals.map(rec => details["sr_profile_" + rec.key] || rec);
      for (const rec of records) if (rec.detail !== "success") {
        rec.detail = "failed";
        rec.raw._srProfileStatus = "failed";
        rec.raw._srProfileReason = "stopped_before_profile_completed";
      }
      const state = { ...got.sr_state, running: false, phase: "idle", automaticRefresh:null,
        note: "Stopped a stuck tab. Saved athletes are kept; collect their emails to continue." };
      await chrome.storage.local.set({sr_records: records, sr_state: state});
      return {ok: true, total: records.length, note: state.note};
}

const stopRequests = new Map();
const refreshTransfers = new Map();
function requestStop(tabId) {
  if (stopRequests.has(tabId)) return stopRequests.get(tabId);
  const request = stopTab(tabId).finally(() => stopRequests.delete(tabId));
  stopRequests.set(tabId, request);
  return request;
}

async function stopTab(tabId) {
  const transfer = refreshTransfers.get(tabId);
  const transferred = (transfer && (await transfer).tabId) ||
    (await chrome.storage.session.get("sr_transfer_" + tabId))["sr_transfer_" + tabId];
  if (transferred && transferred !== tabId) return requestStop(transferred);
  let timer;
  const stopped = await Promise.race([
    chrome.tabs.sendMessage(tabId, {type: "SR_STOP"}, {frameId: 0}).catch(() => null),
    new Promise(resolve => {timer = setTimeout(() => resolve(null), 2500);}),
  ]);
  clearTimeout(timer);
  if (stopped) return {ok: true, stats: stopped};
  return recoverStoppedTab(tabId);
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.type === "SR_REFRESH_COLLECTION" && sender.tab?.id !== undefined && sender.frameId === 0) {
    const transfer = (async () => {
      const tab = await chrome.tabs.get(sender.tab.id);
      const got = await chrome.storage.local.get("sr_state");
      const refresh = got.sr_state?.automaticRefresh;
      const host = new URL(tab.url).hostname;
      if (stopRequests.has(tab.id) || !got.sr_state?.running || refresh?.token !== msg.token ||
          refresh.url !== tab.url || Date.now()-refresh.at < 0 || Date.now()-refresh.at >= 60000 ||
          !/(^|\.)sports?recruits\.com$|^localhost$/i.test(host)) return {ok:false};
      // A new browsing context releases accumulated profile-page state more
      // reliably than reloading the same heavy renderer. The exact filter URL
      // and local checkpoint are already secured before replacing this tab.
      const replacement = await chrome.tabs.create({url:tab.url,windowId:tab.windowId,index:tab.index,active:tab.active});
      try {
        // Preserve saved groups: the old tab must never be their last tab
        // when removed, otherwise Chrome can delete the synced group.
        if (tab.groupId >= 0) await chrome.tabs.group({tabIds:[replacement.id],groupId:tab.groupId});
        await chrome.storage.session.set({["sr_transfer_" + tab.id]:replacement.id});
      }
      catch (error) { await chrome.tabs.remove(replacement.id).catch(() => {}); throw error; }
      // The user may have closed the old tab while its replacement was opening.
      await chrome.tabs.remove(tab.id).catch(() => {});
      return {ok:true,tabId:replacement.id};
    })().catch(() => ({ok:false}));
    refreshTransfers.set(sender.tab.id,transfer);
    transfer.then(respond);
    return true;
  }
  if (msg?.type === "SR_STATUS" && sender.tab?.id !== undefined && sender.frameId === 0) {
    chrome.storage.session.set({ ["sr_status_" + sender.tab.id]: msg.stats }).catch(() => {});
    return false;
  }
  if (msg?.type === "SR_LAST_STATUS") {
    chrome.storage.session.get("sr_status_" + msg.tabId).then(got => respond(got["sr_status_" + msg.tabId] || null));
    return true;
  }
  if (msg?.type === "SR_STOP_REQUEST" || msg?.type === "SR_STOP_RECOVER") {
    // Keep cancellation in the worker: closing the popup must not cancel Stop.
    const work = msg.type === "SR_STOP_REQUEST" ? requestStop(msg.tabId) : recoverStoppedTab(msg.tabId);
    work.then(respond).catch(() => respond({ok: false}));
    return true;
  }
  if (msg && msg.type === "SR_TRACK_DOWNLOAD") {
    (async () => {
      await chrome.storage.session.set({ [downloadKey(msg.downloadId)]: { tabId: msg.tabId ?? sender.tab?.id ?? null } });
      // A small download may finish before tracking is registered.
      const [item] = await chrome.downloads.search({ id: msg.downloadId });
      if (item) await finishDownload(item.id, item.state);
      respond({ ok: true });
    })().catch(() => respond({ ok: false }));
    return true;
  }
  if (msg && msg.type === "SR_PURGE_NOW") {
    purgeEverywhere(msg.tabId).then(() => respond({ ok: true }));
    return true;
  }
  // Relay only managed child frames, using browser-supplied frame/page identity.
  if (msg?.type === "SR_IFRAME_PAYLOAD" && sender.tab?.id !== undefined && sender.frameId > 0 &&
      typeof msg.requestId === "string" && msg.requestId.startsWith("sr-exporter:") &&
      (!msg.payload || (typeof msg.payload.body === "string" && msg.payload.body.length <= 6 * 1024 * 1024))) {
    chrome.tabs.sendMessage(sender.tab.id, {
      type: "SR_RELAY_PAYLOAD", requestId: msg.requestId,
      frameId: sender.frameId, pageUrl: sender.url,
      payload: msg.payload, emails: msg.emails, loaded: msg.loaded,
    }, { frameId: 0 }).then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
    return true;
  }
  return false;
});

// clear on restart too, nothing should stick around between sessions
chrome.runtime.onStartup.addListener(() => removeCollection());
// A development reload is an update, not a new browser session. Preserve an
// unfinished collection so it can be resumed after applying a fix.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") removeCollection();
});
