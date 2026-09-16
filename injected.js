// This one runs in the page's own JS world (MAIN), not the extension's.
// Content scripts are sandboxed so they can't see window.fetch, which is the
// whole point here - the site is already logged in and already downloads the
// athlete data to draw the page, so we just listen in instead of calling the
// API ourselves. Doesn't change any request, just reads the responses.

(function () {
  const TAG = "__SR_EXPORTER_CAPTURE__";
  const MAX_BODY = 6 * 1024 * 1024; // skip absurd payloads

  function forward(url, body) {
    if (!body || body.length > MAX_BODY) return;
    // quick check so we don't ship every HTML response over postMessage
    const head = body.slice(0, 200).trim();
    if (!head.startsWith("{") && !head.startsWith("[")) return;
    try {
      window.postMessage({ tag: TAG, url: String(url), body }, window.location.origin);
    } catch (_) { /* payload not structured-cloneable; ignore */ }
  }

  // --- fetch ---------------------------------------------------------------
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (...args) {
      return origFetch.apply(this, args).then((res) => {
        try {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("json") || ct.includes("javascript")) {
            // have to clone, a response body can only be read once
            res.clone().text().then((t) => forward(res.url || args[0], t)).catch(() => {});
          }
        } catch (_) {}
        return res;
      });
    };
  }

  // --- XMLHttpRequest ------------------------------------------------------
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__srUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", () => {
      try {
        const ct = this.getResponseHeader("content-type") || "";
        if (!ct.includes("json") && !ct.includes("javascript")) return;
        if (this.responseType && this.responseType !== "text" && this.responseType !== "json") return;
        const body = this.responseType === "json" ? JSON.stringify(this.response) : this.responseText;
        forward(this.responseURL || this.__srUrl, body);
      } catch (_) {}
    });
    return origSend.apply(this, args);
  };

  // Some sites dump their data straight into the HTML instead of fetching it,
  // so check the script tags too - that data never shows up in fetch/XHR.
  function harvestInlineState() {
    for (const el of document.querySelectorAll("script")) {
      const type = (el.type || "").toLowerCase();
      const text = el.textContent || "";
      if (!text || text.length > MAX_BODY) continue;
      if (type.includes("json")) {
        forward(location.href + "#inline", text);
      } else if (/__(NEXT|NUXT|INITIAL_STATE|APOLLO_STATE|PRELOADED_STATE)__/.test(text)) {
        const m = text.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
        if (m) forward(location.href + "#inline", m[1]);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", harvestInlineState, { once: true });
  } else {
    harvestInlineState();
  }
})();
