// Main logic. Gets the payloads injected.js picked up, pulls the athletes out,
// keeps scrolling/clicking for more, and holds everything until you export.

(function () {
  const TAG = "__SR_EXPORTER_CAPTURE__";
  const STORAGE_KEY = "sr_records";
  const STATE_KEY = "sr_state";
  const DETAIL_PREFIX = "sr_profile_";
  const E = globalThis.SRExtract;

  const records = new Map();

  const DEFAULT_TARGET = 500;
  let state = {
    running: false,
    target: DEFAULT_TARGET,
    idleRounds: 0,
    lastCount: 0,
    phase: "idle",
    note: "",
    detailsDone: 0,
  };

  const DEBUG = false; // Enable only when diagnosing profile capture.
  const PROFILE_TIMEOUT = 15000;
  const PROFILE_SETTLE = 1200;
  const PROFILE_WORKERS = 2;
  const PROFILE_BATCH_SIZE = 20;
  const PROFILE_REFRESH_AFTER = 60;
  const statCache = new WeakMap();
  const FRAME_PREFIX = "sr-exporter:";
  const log = (...args) => { if (DEBUG) console.log("[SRExporter]", ...args); };
  const athleteName = (raw) => {
    const first = raw.firstName || raw.firstname || raw.personal?.givenName;
    const last = raw.lastName || raw.lastname || raw.personal?.familyName;
    return first && last ? `${first} ${last}` : E.guessName(E.flatten(raw));
  };
  const nameOf = (r) => athleteName(r.raw) || r.key;
  const normalize = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
  const pageKey = (s) => { try { const u = new URL(s); u.hash = ""; return u.href; } catch (_) { return ""; } };

  // Inspect only newly inserted/changed iframe nodes during mutation delivery.
  // Scanning the entire document for every widget mutation grows with the list.
  function videoFrames(mutations) {
    if (!mutations) return document.querySelectorAll('iframe[src]');
    const frames = new Set();
    for (const mutation of mutations) {
      const nodes = mutation.type === "attributes" ? [mutation.target] : mutation.addedNodes;
      for (const node of nodes || []) {
        if (node.tagName === "IFRAME") frames.add(node);
        else if (node.querySelectorAll) for (const frame of node.querySelectorAll('iframe[src]')) frames.add(frame);
      }
    }
    return frames;
  }

  // Child frames only relay. They never collect, restore, paginate or save.
  if (window.self !== window.top) {
    if (!window.name.startsWith(FRAME_PREFIX)) return;
    const requestId = window.name;
    const relay = (body) => chrome.runtime.sendMessage({
      type: "SR_IFRAME_PAYLOAD", requestId, ...body,
    }).catch(() => {});
    const domEmails = () => [...document.querySelectorAll('a[href^="mailto:"]')].flatMap((a) => {
      try { return E.sweepEmails(decodeURIComponent(a.getAttribute("href").slice(7).split("?")[0])); }
      catch (_) { return []; }
    });
    const skipVideoPreviews = (mutations) => {
      // Only our hidden capture pages omit the observed video-player embed.
      // Contact requests and the user's visible search/profile pages stay intact.
      for (const frame of videoFrames(mutations)) {
        try {
          const url = new URL(frame.getAttribute('src'), location.href);
          if (url.hostname === 'app.sportsrecruits.com' && /^\/video-playlists\/\d+\/embedded-player$/.test(url.pathname)) frame.remove();
        } catch (_) {}
      }
    };
    window.addEventListener("message", (ev) => {
      if (ev.source !== window || ev.origin !== location.origin || ev.data?.tag !== TAG) return;
      relay({ payload: { body: ev.data.body }, emails: domEmails() });
    });
    const ready = () => {
      skipVideoPreviews();
      relay({ loaded: true, emails: domEmails() });
      let timer = null;
      let previousEmails = JSON.stringify(domEmails());
      new MutationObserver((mutations) => {
        skipVideoPreviews(mutations);
        if (timer !== null) return;
        timer = setTimeout(() => {
          timer = null;
          const emails = domEmails();
          const signature = JSON.stringify(emails);
          if (signature !== previousEmails) { previousEmails = signature; relay({ emails }); }
        }, 100);
      }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "src"] });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
    else ready();
    return;
  }

  let generation = 0;
  let latestSearch = []; // Latest top-frame list, validated against visible cards at Start.
  let capturePaused = false;
  const pendingProfileRequests = new Map();
  let paginateTimer = null;
  let saveTimer = null;
  let previewObserver = null;
  let searchScrollers = null;
  const pausedPreviews = new Map();

  function pauseSearchPreviews() {
    const pause = (mutations) => {
      if (!state.running) return;
      // Virtualized rows are discarded by the site. Do not keep detached video
      // elements alive merely to restore a preview that is no longer visible.
      for (const mutation of mutations || []) {
        for (const frame of videoFrames([{type:"childList",addedNodes:mutation.removedNodes || []}])) {
          if (frame.isConnected === false) pausedPreviews.delete(frame);
        }
      }
      for (const frame of videoFrames(mutations)) {
        const source = frame.getAttribute('src');
        try {
          const url = new URL(source, location.href);
          if (url.hostname !== 'app.sportsrecruits.com' || !/^\/video-playlists\/\d+\/embedded-player$/.test(url.pathname)) continue;
          pausedPreviews.set(frame, source);
          frame.src = 'about:blank';
        } catch (_) {}
      }
    };
    pause();
    previewObserver = new MutationObserver(pause);
    previewObserver.observe(document.documentElement, {childList:true,subtree:true,attributes:true,attributeFilter:['src']});
  }

  function restoreSearchPreviews() {
    previewObserver?.disconnect();
    previewObserver = null;
    for (const [frame, source] of pausedPreviews) {
      if (frame.isConnected === false) continue;
      // Restore real URLs with browser-native lazy loading, so offscreen players
      // do not all restart at once after a long collection.
      frame.loading = 'lazy';
      frame.src = source;
    }
    pausedPreviews.clear();
  }

  // --- saving ---
  // debounced - scrolling fires a LOT of responses and saving on each one lags
  function saveNow(completedRecord) {
    clearTimeout(saveTimer); saveTimer = null;
    const value = completedRecord ? {
      [DETAIL_PREFIX + completedRecord.key]: {key:completedRecord.key,raw:completedRecord.raw,detail:completedRecord.detail},
      [STATE_KEY]: state,
    } : {
      [STORAGE_KEY]: [...records.values()].map(r => ({key:r.key,raw:r.raw,detail:r.detail})),
      [STATE_KEY]: state,
    };
    return chrome.storage.local.set(value).then(() => true).catch(() => {
      state.note = "Could not save the latest checkpoint. Stop and export before reloading.";
      broadcast();
      return false;
    });
  }
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => saveNow(), 5000);
  }

  const restored = restore();

  function restore() {
    return chrome.storage.local.get([STORAGE_KEY, STATE_KEY]).then(async (got) => {
      const saved = got[STORAGE_KEY] || [];
      const details = saved.length ? await chrome.storage.local.get(saved.map(r => DETAIL_PREFIX + r.key)) : {};
      for (const original of saved) {
        const r = details[DETAIL_PREFIX + original.key] || original;
        records.set(r.key, { key: r.key, raw: r.raw, seen: 1, detail: ["success", "failed"].includes(r.detail) ? r.detail : "pending" });
      }
      if (got[STATE_KEY]) {
        // don't auto-restart after a reload, that surprised me while testing
        state = { ...state, target: got[STATE_KEY].target || DEFAULT_TARGET, running: false, phase: "idle", note: "Previous collection restored. Start creates a fresh collection." };
      }
      const refresh = got[STATE_KEY]?.automaticRefresh;
      if (got[STATE_KEY]?.running && refresh?.url === location.href &&
          Date.now() - refresh.at >= 0 && Date.now() - refresh.at < 60000) {
        state = {...state, running:true, phase:"collecting", profilesSinceRefresh:0,
          detailsDone:saved.filter(r => records.get(r.key)?.detail !== "pending").length,
          idleRounds:0,lastCount:0,visibleHighWater:-1,idleLimit:8,
          note:"Collection restored after refreshing the page. Continuing..."};
        pauseSearchPreviews();
        scheduleSave();
        // Allow the site's current result cards to render before matching them.
        paginateTimer = setTimeout(paginateTick, 1600);
      }
      broadcast();
    }).catch(() => {});
  }

  // Only actual site URLs are accepted. A bare slug is not a URL pattern.
  function suppliedUrl(value) {
    if (typeof value !== "string" || !/^(https?:\/\/|\/|\.\.?\/)/i.test(value)) return "";
    try {
      const u = new URL(value, location.href);
      const allowed = (u.protocol === "https:" && /(^|\.)sports?recruits\.com$/i.test(u.hostname)) ||
        (u.origin === location.origin && u.hostname === "localhost");
      if (!allowed || u.username || u.password || [...u.searchParams.keys()].some((k) => /token|auth|password|secret|session|signature/i.test(k))) return "";
      return u.href;
    } catch (_) { return ""; }
  }

  function jsonProfileUrls(raw) {
    const urls = new Set();
    const visit = (node, path = "", depth = 0) => {
      if (!node || typeof node !== "object" || depth > 8 || Array.isArray(node)) return;
      for (const [key, value] of Object.entries(node)) {
        const field = path ? path + "." + key : key;
        if (/club|school|team|coach|parent|guardian|organization|image|photo|avatar|video|social/i.test(field)) continue;
        if (typeof value === "object") visit(value, field, depth + 1);
        else if (/url|path|href|permalink|link/i.test(key) &&
          (/profile|athlete|player|prospect|recruit/i.test(field) || /\/(athlete|player|profile|prospect|recruit)(?:\/|\?)/i.test(value))) {
          const url = suppliedUrl(value);
          if (url) urls.add(url);
        }
      }
    };
    visit(raw);
    return [...urls];
  }

  // Prefer explicit athlete IDs. Name fallback requires an exact, unique
  // name in a bounded result container; never substring-match random links.
  function cardSnapshot() {
    let cards = [...document.querySelectorAll('[data-card-index], [data-athlete-id], [data-prospect-id], [data-profile-id]')];
    if (!cards.length) cards = [...document.querySelectorAll('article, li, tr, [class*="card"], [class*="result"]')];
    const ids = new Map(), names = new Map();
    const add = (map, key, card) => {
      if (!key) return;
      const matches = map.get(key) || [];
      if (!matches.includes(card)) matches.push(card);
      map.set(key, matches);
    };
    for (const card of cards) {
      for (const attr of ["data-athlete-id", "data-prospect-id", "data-profile-id"]) add(ids, card.getAttribute(attr), card);
      const first = card.querySelector('[data-test-id="firstname"]');
      const last = card.querySelector('[data-test-id="lastname"]');
      const cardNames = new Set();
      if (first && last) cardNames.add(normalize(`${first.textContent} ${last.textContent}`));
      else for (const el of card.querySelectorAll('h1, h2, h3, h4, h5, h6, a[href]')) cardNames.add(normalize(el.textContent));
      for (const name of cardNames) add(names, name, card);
    }
    return { ids, names };
  }

  function resultCard(raw, snapshot = cardSnapshot()) {
    const byId = snapshot.ids.get(E.recordId(raw)) || [];
    if (byId.length) return byId.length === 1 ? byId[0] : null;
    const byName = snapshot.names.get(normalize(athleteName(raw))) || [];
    const smallest = byName.filter(c => !byName.some(other => other !== c && c.contains(other)));
    return smallest.length === 1 ? smallest[0] : null;
  }

  function getProfileUrl(rec, matchedCard) {
    const cached = suppliedUrl(rec.raw._srProfileUrl);
    if (cached) return cached; // Preserve a real href before pagination virtualizes its card.
    const card = matchedCard || resultCard(rec.raw);
    log(`Profile link lookup: ${nameOf(rec)}; row=${card?.getAttribute('data-card-index') ?? 'generic'}; links=${card?.querySelectorAll('a[href]').length ?? 0}`);
    if (card) {
      const urls = [...new Set([...card.querySelectorAll('a[href]')]
        .filter((a) => /^(view\s+profile|profile)$/i.test((a.textContent || a.getAttribute("aria-label") || "").trim()))
        .map((a) => suppliedUrl(a.getAttribute("href"))).filter(Boolean))];
      if (urls.length === 1) return urls[0];
      if (urls.length > 1) return "";
      const name = normalize(athleteName(rec.raw));
      const named = [...new Set([...card.querySelectorAll('a[href]')]
        .filter((a) => normalize(a.textContent) === name)
        .map((a) => suppliedUrl(a.getAttribute("href"))).filter(Boolean))];
      if (named.length === 1) return named[0];
    }
    const urls = jsonProfileUrls(rec.raw);
    return urls.length === 1 ? urls[0] : "";
  }

  // Merge nested fields without letting an empty search field erase detail data.
  function mergeRaw(old, richer) {
    const out = { ...old };
    for (const [key, value] of Object.entries(richer)) {
      if (value === null || value === undefined || value === "") continue;
      if (Array.isArray(value)) {
        const seen = new Set();
        out[key] = [...(Array.isArray(out[key]) ? out[key] : []), ...value].filter(item => {
          const signature = JSON.stringify(item);
          if (seen.has(signature)) return false;
          seen.add(signature); return true;
        });
      } else if (typeof value === "object") out[key] = mergeRaw(out[key] && typeof out[key] === "object" ? out[key] : {}, value);
      else out[key] = value;
    }
    return out;
  }

  function ingest(athletes) {
    if (!state.running || state.phase !== "collecting") return;
    let changed = false;
    let snapshot;
    for (const a of athletes) {
      const key = E.recordKey(a);
      const existing = records.get(key);
      if (existing && (existing.search === a || existing.detail !== "pending")) continue;
      // Validate new/changed search records against one snapshot of visible cards.
      const card = resultCard(a, snapshot ||= cardSnapshot());
      if (!card) continue;
      if (existing) {
        existing.raw = mergeRaw(existing.raw, a);
        existing.search = a;
        changed = true;
      } else if (records.size < state.target) {
        records.set(key, { key, raw: a, search: a, seen: 1, detail: "pending" });
        log(`Search athlete discovered: ${nameOf(records.get(key))} / ${E.recordId(a) || "unknown"}`);
        changed = true;
      }
      const rec = records.get(key);
      if (rec && !rec.raw._srProfileUrl) {
        const url = getProfileUrl(rec, card);
        if (url) rec.raw._srProfileUrl = url;
      }
    }
    if (changed) { scheduleSave(); broadcast(); }
  }

  window.addEventListener("message", (ev) => {
    if (capturePaused || ev.source !== window || ev.origin !== location.origin || ev.data?.tag !== TAG) return;
    let payload;
    try { payload = JSON.parse(ev.data.body); } catch (_) { return; }
    const athletes = E.extractAthletes(payload);
    // A singleton profile response must not replace the latest result list.
    if (!E.findRecordLists(payload).length) return;
    if (athletes.length) latestSearch = athletes;
    // Site network callbacks can run before its result cards render.
    const run = generation;
    setTimeout(() => { if (run === generation) ingest(athletes); }, 300);
  });

  // Search mailto links enrich the associated record; never add email-only rows.
  function scrapeDomEmails() {
    // The live search normally has no mailto links. Avoid repeatedly matching
    // every collected athlete against the DOM when there is nothing to capture.
    if (!document.querySelectorAll('a[href^="mailto:"]').length) return;
    const snapshot = cardSnapshot();
    for (const rec of records.values()) {
      const card = resultCard(rec.raw, snapshot);
      if (!card) continue;
      const emails = [...card.querySelectorAll('a[href^="mailto:"]')].flatMap((a) => {
        try { return E.sweepEmails(decodeURIComponent(a.getAttribute("href").slice(7).split("?")[0])); }
        catch (_) { return []; }
      });
      if (emails.length) { rec.raw = mergeRaw(rec.raw, { _srDomEmails: emails }); scheduleSave(); }
    }
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

  function knownCardTail() {
    const cards = [...document.querySelectorAll('[data-card-index]')];
    if (!cards.length || !cards.at(-1).getBoundingClientRect) return null;
    const known = new Set([...records.values()].map(rec => rec.raw._srProfileUrl).filter(Boolean));
    // A longer jump is safe only when every mounted row's real profile href
    // has already been saved. Unknown/ambiguous rows keep viewport-sized steps.
    for (const card of cards) {
      const links = [...card.querySelectorAll('a[href]')].filter(a => /^(view\s+profile|profile)$/i.test(a.textContent.trim()));
      if (links.length !== 1 || !known.has(suppliedUrl(links[0].getAttribute('href')))) return null;
    }
    return cards.at(-1);
  }

  function scrollContainers() {
    let moved = false;
    const tail = knownCardTail();
    let travelTicks = 0;
    if (!searchScrollers || searchScrollers.some(el => el.isConnected === false)) searchScrollers = [...document.querySelectorAll("div, main, section, ul")].filter(el =>
      el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 200 &&
      /auto|scroll/.test(getComputedStyle(el).overflowY) && el.querySelector('[data-card-index]'));
    const inner = searchScrollers.filter(el => !searchScrollers.some(other => other !== el && el.contains(other)));
    for (const el of inner) {
      const before = el.scrollTop;
      const baseline = Math.max(200, Math.floor(el.clientHeight * 0.75));
      const advance = tail && el.contains(tail) ? tail.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom + 128 : 0;
      const step = Math.max(baseline, advance);
      const end = Math.max(0, el.scrollHeight - el.clientHeight);
      travelTicks = Math.max(travelTicks, Math.ceil(Math.max(0, end - before) / step));
      el.scrollTop = Math.min(end, before + step);
      moved ||= el.scrollTop > before;
    }
    if (!moved) {
      const before = window.scrollY;
      const baseline = Math.max(200, Math.floor(window.innerHeight * 0.75));
      const advance = tail ? tail.getBoundingClientRect().bottom - window.innerHeight + 128 : 0;
      const step = Math.max(baseline, advance);
      const end = Math.max(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight || 0) - window.innerHeight);
      travelTicks = Math.max(travelTicks, Math.ceil(Math.max(0, end - before) / step));
      window.scrollTo({top: Math.min(end, before + step), behavior: "instant"});
      moved = window.scrollY > before;
    }
    return { moved, quietLimit: Math.min(120, 8 + travelTicks) };
  }

  function paginateTick() {
    if (!state.running || state.phase !== "collecting") return;
    ingest(latestSearch);

    if (records.size >= state.target) {
      fetchDetails(generation, true);
      return;
    }
    // Pause discovery for bounded contact batches instead of waiting for every
    // requested athlete. This also avoids scrolling while profile pages load.
    const waiting = [...records.values()].filter(rec => rec.detail === "pending").length;
    if (waiting >= PROFILE_BATCH_SIZE) {
      fetchDetails(generation, false);
      return;
    }

    scrapeDomEmails();
    const scroll = scrollContainers();
    const clicked = !scroll.moved && clickNext();

    const visibleIndices = [...document.querySelectorAll('[data-card-index]')].map(card => {
      const value = card.getAttribute('data-card-index');
      return value !== null && /^\d+$/.test(value) ? Number(value) : -1;
    });
    const visibleHighWater = Math.max(-1, ...visibleIndices);
    if (records.size === state.lastCount && visibleHighWater <= (state.visibleHighWater ?? -1)) {
      state.idleRounds++;
    } else {
      state.visibleHighWater = Math.max(state.visibleHighWater ?? -1, visibleHighWater);
      state.idleRounds = 0;
      state.lastCount = records.size;
      // Tall video cards can require more than eight viewport steps before the
      // next result page loads. Snapshot a finite travel allowance only when
      // new athletes arrive; endlessly growing page widgets cannot renew it.
      state.idleLimit = scroll.quietLimit;
    }

    // wait a few quiet rounds before giving up, slow pages need the time
    const loadingResults = [...document.querySelectorAll('.spinner')].some(el => {
      const box = el.getBoundingClientRect();
      return box.height > 0 && box.top < window.innerHeight && box.bottom > 0;
    });
    const limit = Math.max(clicked ? 12 : 8, state.idleLimit || 8, loadingResults ? 30 : 0);
    if (state.idleRounds >= limit) {
      log(`Only ${records.size}/${state.target} visible athletes discovered; inspect the result card DOM and search JSON.`);
      fetchDetails(generation, true);
      return;
    }

    state.note = `${clicked ? "Loading more results" : "Finding athletes"}: ${records.size} of ${state.target}; ${state.detailsDone} profiles checked.`;
    broadcast();
    paginateTimer = setTimeout(paginateTick, 1600);
  }

  // Profile data must come from this run's managed frame AND match its athlete.
  function profileMessage(msg) {
    const pending = pendingProfileRequests.get(msg.requestId);
    if (!pending || !state.running || pending.run !== generation || !msg.frameId) return;
    if (pageKey(msg.pageUrl) !== pageKey(pending.url)) {
      pending.reason = "unexpected_profile_page"; // Redirect/login requires inspection.
      return;
    }
    if (pending.frameId && pending.frameId !== msg.frameId) return;
    pending.frameId = msg.frameId;
    const wasLoaded = pending.loaded;
    const previousEmails = pending.emails.length;
    if (msg.loaded) pending.loaded = true;
    if (Array.isArray(msg.emails)) pending.emails = [...new Set([...pending.emails, ...E.sweepEmails(msg.emails)])];
    if (!msg.payload) {
      // Video/widget href mutations can keep sending identical mailto scans.
      // Only newly rendered addresses or initial readiness extend capture.
      if ((!wasLoaded && pending.loaded) || pending.emails.length !== previousEmails) settleProfile(pending);
      return;
    }
    pending.received = true;
    log(`Profile payload received: ${nameOf(pending.rec)}`);
    let athletes;
    let payload;
    try { payload = JSON.parse(msg.payload.body); athletes = E.extractAthletes(payload); }
    catch (_) { pending.reason = "payload_parse_or_extraction_failed"; return; }
    const expectedId = E.recordId(pending.rec.raw);
    // Hash/email keys aren't stable identity across richer payloads. Require ID.
    const matches = athletes.filter((a) => expectedId && E.recordId(a) === expectedId);
    const expectedName = normalize(athleteName(pending.rec.raw));
    const match = matches.find((a) => {
      const actualName = normalize(athleteName(a));
      return !expectedName || !actualName || expectedName === actualName;
    });
    if (!match) {
      if (athletes.length) {
        pending.mismatch = true;
        log(`Profile payload did not match ${nameOf(pending.rec)}`, JSON.stringify(athletes.slice(0, 3).map((a) => ({ id: E.recordId(a), name: E.guessName(E.flatten(a)), keys: Object.keys(a) }))));
      }
      return;
    }
    pending.rec.raw = mergeRaw(pending.rec.raw, match);
    if (pending.reason === "payload_parse_or_extraction_failed") pending.reason = "";
    pending.matched = true;
    log(`Profile payload matched athlete: ${nameOf(pending.rec)}`);
    // Only the observed normalized profile schema can use the fast path.
    // Partial payloads and coach-only email responses keep the full timeout.
    if (payload?.resources?.athletes && payload.root &&
        ["emailAddress", "phoneNumber", "gpa"].every((key) => Object.hasOwn(match, key))) {
      pending.contactReady = true;
      pending.directEmailReady = !!E.sweepEmails(match.emailAddress).length;
    }
    settleProfile(pending);
  }

  function settleProfile(pending) {
    if (!pending.matched || !pending.contactReady || (!pending.loaded && !pending.directEmailReady) || pending.reason) return;
    clearTimeout(pending.settleTimer);
    pending.settleTimer = setTimeout(() => pending.finish(), PROFILE_SETTLE);
  }

  function loadProfile(rec, url, run) {
    return new Promise((resolve) => {
      const iframe = document.createElement("iframe");
      const requestId = FRAME_PREFIX + crypto.randomUUID();
      iframe.name = requestId;
      iframe.style.display = "none";
      const pending = { rec, url, run, emails: [], matched: false, loaded: false, received: false, mismatch: false };
      pending.finish = (reason) => {
        if (!pendingProfileRequests.has(requestId)) return;
        clearTimeout(pending.timer);
        clearTimeout(pending.settleTimer);
        pendingProfileRequests.delete(requestId);
        document.removeEventListener("securitypolicyviolation", blocked);
        iframe.remove();
        resolve({ ...pending, reason: reason || pending.reason });
      };
      const blocked = (ev) => {
        if (/frame-src|child-src/.test(ev.effectiveDirective) && pageKey(ev.blockedURI) === pageKey(url)) {
          log(`Profile page blocked from iframe for ${nameOf(rec)}`);
          pending.finish("iframe_blocked_by_parent_csp");
        }
      };
      document.addEventListener("securitypolicyviolation", blocked);
      iframe.addEventListener("error", () => pending.finish("profile_page_load_failed"));
      // Register before navigating: an immediate response must not be lost.
      pendingProfileRequests.set(requestId, pending);
      pending.timer = setTimeout(() => pending.finish(), PROFILE_TIMEOUT);
      iframe.src = url;
      try { document.body.appendChild(iframe); }
      catch (_) { pending.finish("profile_page_load_failed"); }
    });
  }

  async function fetchDetails(run, finalBatch = true) {
    if (!state.running || run !== generation || state.phase === "details") return;
    if (paginateTimer) { clearTimeout(paginateTimer); paginateTimer = null; }
    scrapeDomEmails();
    state.phase = "details";
    state.note = `Collecting emails: ${state.detailsDone} of ${records.size} profiles checked (limit ${state.target}).`;
    broadcast();
    // Save the discovered list once per batch; profile checkpoints then write
    // only one athlete instead of copying hundreds of rich profiles repeatedly.
    await saveNow();
    if (!state.running || run !== generation) return;
    const waiting = [...records.values()].filter(rec => rec.detail === "pending");
    const queue = finalBatch ? waiting : waiting.slice(0, PROFILE_BATCH_SIZE);
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        if (!state.running || run !== generation) return;
        const rec = queue[cursor++];
        const url = getProfileUrl(rec);
        rec.detail = "pending";
        let result;
        if (!url) {
          rec.detail = "failed";
          rec.raw._srProfileReason = "profile_url_not_discovered";
          log(`No profile URL found for ${nameOf(rec)}`);
        } else if (!E.recordId(rec.raw)) {
          rec.detail = "failed";
          rec.raw._srProfileReason = "no_stable_athlete_id";
          log(`Cannot correlate profile without a stable athlete ID: ${nameOf(rec)}`);
        } else {
          rec.raw._srProfileUrl = url;
          // Omit query/fragment from logs: those can contain session information.
          const safe = new URL(url);
          log(`Profile URL discovered: ${safe.origin}${safe.pathname}`);
          log(`Loading profile: ${nameOf(rec)}`);
          result = await loadProfile(rec, url, run);
          if (!state.running || run !== generation) return;
          if (result.matched && !result.reason) {
            rec.raw = mergeRaw(rec.raw, { _srDomEmails: result.emails });
            rec.detail = "success";
            let emails;
            try { emails = E.sweepEmails(rec.raw); }
            catch (_) { rec.detail = "failed"; rec.raw._srProfileReason = "email_extraction_failed"; log(`Email extraction failed for ${nameOf(rec)}`); }
            if (emails) {
              rec.raw._srProfileReason = emails.length ? "email_found" : "profile_matched_no_email_found";
              log(`Emails found: ${JSON.stringify(emails)}`);
              if (!emails.length) log(`Profile loaded but no email found for ${nameOf(rec)} (captured payloads and rendered mailto links)`);
              log(`Profile merged: ${nameOf(rec)}`);
            }
          } else {
            rec.detail = "failed";
            rec.raw._srProfileReason = result.reason || (result.mismatch ? "payload_athlete_mismatch" :
              result.received ? "payload_has_no_matching_athlete" : result.loaded ? "profile_loaded_no_payload" : "no_profile_capture_iframe_blocking_unknown");
            if (!result.received) log(`No profile payload captured for ${nameOf(rec)}; iframe blocking/load failure requires browser Console/Network inspection.`);
            log(`Profile failed: ${nameOf(rec)} / ${rec.raw._srProfileReason}`);
          }
        }
        rec.raw._srProfileStatus = rec.detail;
        state.detailsDone++;
        state.profilesSinceRefresh = (state.profilesSinceRefresh || 0) + 1;
        state.note = `Collecting emails: ${state.detailsDone} of ${records.size} profiles checked (limit ${state.target}).`;
        await saveNow(rec);
        if (!state.running || run !== generation) return;
        broadcast();
        // Let the other in-flight worker settle, but do not create more frames
        // once this page has reached its bounded profile-navigation budget.
        if (state.profilesSinceRefresh >= PROFILE_REFRESH_AFTER) return;
      }
    };
    await Promise.all(Array.from({ length: PROFILE_WORKERS }, worker));
    if (!state.running || run !== generation) return;
    const moreWork = [...records.values()].some(rec => rec.detail === "pending") || (!finalBatch && records.size < state.target);
    if (moreWork && state.profilesSinceRefresh >= PROFILE_REFRESH_AFTER) {
      state.automaticRefresh = {token:crypto.randomUUID(),url:location.href,at:Date.now()};
      state.note = `Opening a fresh search tab after ${state.detailsDone} profiles. Collected athletes and emails are saved; collection will continue.`;
      broadcast();
      const saved = await saveNow();
      if (!state.running || run !== generation) return;
      const result = saved && await chrome.runtime.sendMessage({type:"SR_REFRESH_COLLECTION",token:state.automaticRefresh.token}).catch(() => null);
      if (result?.ok) return;
      delete state.automaticRefresh;
      finish("Could not refresh the tab. Collected athletes are kept; collect their emails to continue.");
      await saveNow();
      return;
    }
    if (!finalBatch) {
      state.phase = "collecting";
      state.note = "Finding more athletes...";
      broadcast();
      paginateTimer = setTimeout(paginateTick, 0);
      return;
    }
    const succeeded = [...records.values()].filter((r) => r.detail === "success").length;
    const short = records.size < state.target ? " Search stopped adding results before the chosen limit." : "";
    finish(`Done: ${records.size}/${state.target} athletes; ${succeeded} profiles matched, ${records.size - succeeded} failed.${short} Review any failures in All Data.`);
  }

  function cancelWork() {
    generation++;
    delete state.automaticRefresh;
    restoreSearchPreviews();
    if (paginateTimer) { clearTimeout(paginateTimer); paginateTimer = null; }
    for (const pending of [...pendingProfileRequests.values()]) pending.finish("cancelled");
    for (const rec of records.values()) {
      if (rec.detail === "pending") {
        rec.detail = "failed";
        rec.raw._srProfileStatus = "failed";
        rec.raw._srProfileReason = "stopped_before_profile_completed";
      }
    }
  }

  // --- start/stop ---
  function finish(note) {
    state.running = false;
    restoreSearchPreviews();
    state.phase = "idle";
    state.note = note;
    if (paginateTimer) { clearTimeout(paginateTimer); paginateTimer = null; }
    scheduleSave();
    broadcast();
  }

  async function start(target) {
    await restored;
    if (state.running) return;
    cancelWork();
    // A new collection must never mix athletes from previous filter selections.
    const previousDetails = [...records.keys()].map(key => DETAIL_PREFIX + key);
    if (previousDetails.length) await chrome.storage.local.remove(previousDetails);
    records.clear();
    capturePaused = false;
    searchScrollers = null;
    state = { ...state, target: Math.min(10000, Math.max(1, Math.floor(Number(target) || DEFAULT_TARGET))), running: true, phase: "collecting", idleRounds: 0,
      lastCount: 0, visibleHighWater: -1, idleLimit: 8, detailsDone: 0, profilesSinceRefresh:0, note: "Collecting athletes from the current filtered results..." };
    pauseSearchPreviews();
    scheduleSave();
    broadcast();
    paginateTick();
  }

  async function resumeProfiles() {
    await restored;
    if (state.running || !records.size) return;
    cancelWork();
    for (const rec of records.values()) {
      if (rec.detail === "success") continue;
      rec.detail = "pending";
      delete rec.raw._srProfileStatus;
      delete rec.raw._srProfileReason;
    }
    state.running = true;
    pauseSearchPreviews();
    state.phase = "ready";
    state.detailsDone = [...records.values()].filter(rec => rec.detail === "success").length;
    scheduleSave();
    fetchDetails(generation, true);
  }

  async function stop() {
    await restored;
    cancelWork(); finish("Stopped. Collected athletes are kept; use Collect emails for these athletes to continue.");
    await saveNow();
  }

  async function purge() {
    await restored;
    cancelWork();
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const detailKeys = [...records.keys()].map(key => DETAIL_PREFIX + key);
    records.clear();
    latestSearch = [];
    capturePaused = true; // No background recapture after export/manual deletion.
    state = { ...state, running: false, phase: "idle", note: "All data deleted.", detailsDone: 0, lastCount: 0 };
    await chrome.storage.local.remove([STORAGE_KEY, STATE_KEY, ...detailKeys]);
    broadcast();
  }

  function stats() {
    let withEmail = 0, withIg = 0;
    for (const r of records.values()) {
      let cached = statCache.get(r.raw);
      if (!cached) {
        cached = { email: !!E.sweepEmails(r.raw).length, ig: !!E.sweepInstagram(r.raw).length };
        statCache.set(r.raw, cached);
      }
      if (cached.email) withEmail++;
      if (cached.ig) withIg++;
    }
    return {
      total: records.size, withEmail, withIg,
      running: state.running, phase: state.phase, note: state.note,
      target: state.target, detailsDone: state.detailsDone, supportsBatchLimit: true, supportsProfileResume: true,
    };
  }

  function broadcast() {
    chrome.runtime.sendMessage({ type: "SR_STATUS", stats: stats() }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    switch (msg && msg.type) {
      case "SR_START":   start(msg.target).then(() => respond(stats())); return true;
      case "SR_RESUME_PROFILES": resumeProfiles().then(() => respond(stats())); return true;
      case "SR_STOP":    stop().then(() => respond(stats())); return true;
      case "SR_RELAY_PAYLOAD": profileMessage(msg); respond({ ok: true }); break;
      case "SR_STATUS":  restored.then(() => respond(stats())); return true;
      case "SR_DATA":    restored.then(() => respond({ records: [...records.values()].map((r) => r.raw) })); return true;
      case "SR_PURGE":   purge().then(() => respond(stats())); return true;
      default: respond({ error: "unknown" });
    }
    return false;
  });

})();
