// Main logic. Gets the payloads injected.js picked up, pulls the athletes out,
// keeps scrolling/clicking for more, and holds everything until you export.

(function () {
  const TAG = "__SR_EXPORTER_CAPTURE__";
  const STORAGE_KEY = "sr_records";
  const STATE_KEY = "sr_state";
  const E = globalThis.SRExtract;

  /** @type {Map<string, {key:string, raw:object, seen:number, detail:boolean}>} */
  const records = new Map();

  let state = {
    running: false,
    target: 1000,
    idleRounds: 0,
    lastCount: 0,
    phase: "idle",
    note: "",
    detailTemplate: "",
    detailsDone: 0,
  };

  let paginateTimer = null;
  let saveTimer = null;

  // --- saving ---
  // debounced - scrolling fires a LOT of responses and saving on each one lags
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const payload = [...records.values()].map((r) => ({ key: r.key, raw: r.raw, detail: r.detail }));
      chrome.storage.local.set({ [STORAGE_KEY]: payload, [STATE_KEY]: state }).catch(() => {});
    }, 1500);
  }

  function restore() {
    chrome.storage.local.get([STORAGE_KEY, STATE_KEY]).then((got) => {
      for (const r of got[STORAGE_KEY] || []) {
        records.set(r.key, { key: r.key, raw: r.raw, seen: 1, detail: !!r.detail });
      }
      if (got[STATE_KEY]) {
        // don't auto-restart after a reload, that surprised me while testing
        state = { ...state, ...got[STATE_KEY], running: false, phase: "idle" };
      }
      broadcast();
    }).catch(() => {});
  }

  // --- collecting ---
  function ingest(url, payload) {
    const athletes = E.extractAthletes(payload);
    let added = 0;
    for (const a of athletes) {
      const key = E.recordKey(a);
      const existing = records.get(key);
      if (existing) {
        // profile pages have more fields than search results, so merge them
        const merged = { ...existing.raw, ...a };
        if (Object.keys(merged).length > Object.keys(existing.raw).length) existing.raw = merged;
        existing.seen++;
      } else {
        if (records.size >= state.target && state.phase === "collecting") continue;
        records.set(key, { key, raw: a, seen: 1, detail: false });
        added++;
      }
    }
    if (added) { learnDetailTemplate(url); scheduleSave(); broadcast(); }
    return added;
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data || ev.data.tag !== TAG) return;
    let payload;
    try { payload = JSON.parse(ev.data.body); } catch (_) { return; }
    ingest(ev.data.url, payload);
  });

  // --- backup plan ---
  // if a page renders emails straight into the HTML there's no JSON to catch
  function scrapeDomEmails() {
    const found = new Map();
    for (const a of document.querySelectorAll('a[href^="mailto:"]')) {
      const email = decodeURIComponent(a.getAttribute("href").slice(7)).split("?")[0].trim().toLowerCase();
      if (!email) continue;
      const row = a.closest("tr, li, article, [class*='card'], [class*='row'], [class*='result']") || a.parentElement;
      const name = row ? (row.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "" : "";
      found.set(email, { email, name, source: "page" });
    }
    let added = 0;
    for (const rec of found.values()) {
      const key = "email:" + rec.email;
      if (!records.has(key)) {
        records.set(key, { key, raw: { name: rec.name, email: rec.email, _source: "page-html" }, seen: 1, detail: false });
        added++;
      }
    }
    if (added) { scheduleSave(); broadcast(); }
    return added;
  }

  // --- paging through results ---
  const NEXT_TEXT_RE = /^(load more|show more|see more|next|more results|view more)\b/i;

  function clickNext() {
    const candidates = document.querySelectorAll(
      'button, a[role="button"], [class*="next"], [class*="more"], [aria-label*="ext"], [aria-label*="ore"]'
    );
    for (const el of candidates) {
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      const label = (el.innerText || el.getAttribute("aria-label") || "").trim();
      if (!NEXT_TEXT_RE.test(label)) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue; // hidden
      el.click();
      return true;
    }
    return false;
  }

  function scrollContainers() {
    window.scrollTo(0, document.body.scrollHeight);
    // the list is often its own scrolling div, not the window
    for (const el of document.querySelectorAll("div, main, section, ul")) {
      if (el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 200) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }

  function paginateTick() {
    if (!state.running) return;

    if (records.size >= state.target) {
      finish(`Reached your target of ${state.target}.`);
      return;
    }

    scrapeDomEmails();
    scrollContainers();
    const clicked = clickNext();

    if (records.size === state.lastCount) {
      state.idleRounds++;
    } else {
      state.idleRounds = 0;
      state.lastCount = records.size;
    }

    // wait a few quiet rounds before giving up, slow pages need the time
    const limit = clicked ? 12 : 8;
    if (state.idleRounds >= limit) {
      finish(`No more results loading - stopped at ${records.size}.`);
      return;
    }

    state.note = clicked ? "Loading more results..." : "Scrolling for more results...";
    broadcast();
    paginateTimer = setTimeout(paginateTick, 1600);
  }

  // --- profile details ---
  // I don't know the profile API URL, so instead of guessing: if the user opens
  // one profile, grab that URL, swap the id out for a placeholder, and reuse it
  // for everyone else.
  function learnDetailTemplate(url) {
    if (state.detailTemplate || !url) return;
    for (const rec of records.values()) {
      const id = E.recordId(rec.raw);
      if (id.length < 2) continue;
      if (url.includes("/" + id) || url.includes("=" + id)) {
        state.detailTemplate = url.replace(new RegExp(`(?<=[/=])${id}(?![0-9A-Za-z])`), "{id}");
        broadcast();
        return;
      }
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function fetchDetails() {
    if (!state.detailTemplate) {
      finish("Collected. Tip: open one athlete's profile, then run again to also pull per-profile fields.");
      return;
    }
    state.phase = "details";
    state.detailsDone = 0;

    const pending = [...records.values()].filter((r) => !r.detail);
    for (const rec of pending) {
      if (!state.running) break;
      const id = E.recordId(rec.raw);
      if (!id) { rec.detail = true; continue; }
      try {
        const res = await fetch(state.detailTemplate.replace("{id}", encodeURIComponent(id)), {
          credentials: "include",
          headers: { accept: "application/json" },
        });
        if (res.ok) {
          const body = await res.json();
          const found = E.extractAthletes(body);
          const match = found.find((f) => E.recordKey(f) === rec.key) || found[0];
          if (match) rec.raw = { ...rec.raw, ...match };
        }
      } catch (_) { /* one bad profile shouldn't end the run */ }
      rec.detail = true;
      state.detailsDone++;
      state.note = `Pulling profile details ${state.detailsDone}/${pending.length}...`;
      broadcast();
      scheduleSave();
      await sleep(900 + Math.random() * 500); // stay polite
    }
    finish(`Done. ${records.size} recruits collected.`);
  }

  // --- start/stop ---
  function finish(note) {
    state.running = false;
    state.phase = "idle";
    state.note = note;
    if (paginateTimer) { clearTimeout(paginateTimer); paginateTimer = null; }
    scheduleSave();
    broadcast();
  }

  function start(target) {
    state.target = Math.max(1, target | 0);
    state.running = true;
    state.phase = "collecting";
    state.idleRounds = 0;
    state.lastCount = records.size;
    state.note = "Collecting...";
    broadcast();
    paginateTick();
  }

  function stop() { finish("Stopped."); }

  function purge() {
    records.clear();
    state = { ...state, running: false, phase: "idle", note: "All data deleted.", detailsDone: 0, lastCount: 0 };
    if (paginateTimer) { clearTimeout(paginateTimer); paginateTimer = null; }
    return chrome.storage.local.remove([STORAGE_KEY, STATE_KEY]).then(() => broadcast());
  }

  function stats() {
    let withEmail = 0, withIg = 0;
    for (const r of records.values()) {
      if (E.sweepEmails(r.raw).length) withEmail++;
      if (E.sweepInstagram(r.raw).length) withIg++;
    }
    return {
      total: records.size, withEmail, withIg,
      running: state.running, phase: state.phase, note: state.note,
      target: state.target, hasDetailTemplate: !!state.detailTemplate,
    };
  }

  function broadcast() {
    chrome.runtime.sendMessage({ type: "SR_STATUS", stats: stats() }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    switch (msg && msg.type) {
      case "SR_START":   start(msg.target); respond(stats()); break;
      case "SR_STOP":    stop();            respond(stats()); break;
      case "SR_DETAILS": state.running = true; fetchDetails(); respond(stats()); break;
      case "SR_STATUS":  respond(stats());  break;
      case "SR_DATA":    respond({ records: [...records.values()].map((r) => r.raw) }); break;
      case "SR_PURGE":   purge().then(() => respond(stats())); return true;
      default: respond({ error: "unknown" });
    }
    return false;
  });

  restore();
})();
