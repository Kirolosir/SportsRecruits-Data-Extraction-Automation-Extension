// Fake search site so I can test the extension without a real account.
// Run: node test-harness/server.js  then open http://localhost:8787

const http = require("http");
const { makeProspect, makeDetail } = require("./data.js");

const PORT = 8787;
const TOTAL = 1200;      // total prospects available
const PAGE_SIZE = 25;

const json = (res, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(body);
};

const PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Prospect Search — Mock</title>
<style>
 body{font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f7f6f9;color:#1a1523}
 header{background:#3f1f69;color:#fff;padding:14px 20px;font-weight:600}
 .wrap{max-width:760px;margin:0 auto;padding:20px}
 .bar{background:#fff;border:1px solid #e6e2ec;border-radius:8px;padding:12px;margin-bottom:14px;color:#6b6577}
 #results{display:flex;flex-direction:column;gap:8px}
 .card{background:#fff;border:1px solid #e6e2ec;border-radius:8px;padding:12px 14px}
 .card h3{margin:0 0 4px;font-size:14px}
 .meta{color:#6b6577;font-size:12px}
 a{color:#3f1f69}
 #more{margin:18px auto;display:block;padding:10px 18px;border:1px solid #e6e2ec;
   background:#fff;border-radius:8px;cursor:pointer;font:inherit}
 #done{text-align:center;color:#6b6577;padding:20px;display:none}
</style></head>
<body>
<header>Mock Prospect Search</header>
<div class="wrap">
  <div class="bar">Showing prospects — <span id="count">0</span> of ${TOTAL} loaded</div>
  <div id="results"></div>
  <button id="more">Load more results</button>
  <div id="done">No more results.</div>
</div>
<script>
let page = 0;
async function loadPage() {
  page++;
  // XHR rather than fetch on odd pages, so both intercept paths get exercised.
  const url = "/api/search?page=" + page;
  const payload = page % 2 === 1 ? await viaXhr(url) : await (await fetch(url)).json();
  const items = payload.payload.searchResults.items;
  const box = document.getElementById("results");
  for (const p of items) {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = '<h3>' + p.personal.givenName + ' ' + p.personal.familyName + '</h3>' +
      '<div class="meta">' + p.classYear + ' &middot; ' + p.primaryPosition + ' &middot; ' +
      p.clubTeam.name + ' &middot; ' + p.schoolInfo.name + '</div>' +
      '<a href="' + p.profilePath + '">View profile</a>';
    box.appendChild(el);
  }
  document.getElementById("count").textContent = box.children.length;
  if (!payload.pagination.hasMore) {
    document.getElementById("more").style.display = "none";
    document.getElementById("done").style.display = "block";
  }
}
function viaXhr(url) {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open("GET", url);
    x.onload = () => resolve(JSON.parse(x.responseText));
    x.send();
  });
}
document.getElementById("more").addEventListener("click", loadPage);
// Infinite scroll as well, so both pagination strategies are testable.
window.addEventListener("scroll", () => {
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) {
    const btn = document.getElementById("more");
    if (btn.style.display !== "none" && !btn.dataset.busy) {
      btn.dataset.busy = "1";
      loadPage().finally(() => delete btn.dataset.busy);
    }
  }
});
loadPage();
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/" || url.pathname === "/search") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(PAGE_HTML);
  }

  if (url.pathname === "/api/search") {
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const start = (page - 1) * PAGE_SIZE;
    const items = [];
    for (let i = start; i < Math.min(start + PAGE_SIZE, TOTAL); i++) items.push(makeProspect(i));
    // wrapped in junk like a real response would be, the nav array and the
    // support email are both there to try and trip up the extractor
    return json(res, {
      status: "ok",
      navigation: [{ label: "Home", href: "/" }, { label: "Search", href: "/search" }],
      pagination: { page, pageSize: PAGE_SIZE, total: TOTAL, hasMore: start + PAGE_SIZE < TOTAL },
      payload: { searchResults: { items } },
      support: { email: "help@sportsrecruits.com" },
    });
  }

  const detail = url.pathname.match(/^\/api\/prospect\/(\d+)$/);
  if (detail) {
    const n = parseInt(detail[1], 10) - 100000;
    if (n < 0 || n >= TOTAL) { res.writeHead(404); return res.end("{}"); }
    return json(res, { status: "ok", payload: { prospect: makeDetail(n) } });
  }

  const profile = url.pathname.match(/^\/prospect\/(\d+)$/);
  if (profile) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset="utf-8"><title>Prospect</title>
      <body style="font:14px sans-serif;padding:24px">
      <a href="/">&larr; Back to search</a><h2>Prospect ${profile[1]}</h2>
      <div id="d">Loading…</div>
      <script>
        fetch("/api/prospect/${profile[1]}").then(r=>r.json()).then(j=>{
          const p = j.payload.prospect;
          document.getElementById("d").innerHTML =
            "<p>"+p.personal.givenName+" "+p.personal.familyName+" — "+p.classYear+"</p>" +
            "<p>"+(p.contactInfo ? p.contactInfo.emailAddress : "no email on file")+"</p>";
        });
      </script></body>`);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`Mock SportsRecruits running at http://localhost:${PORT}`);
  console.log(`${TOTAL} prospects, ${PAGE_SIZE} per page. Ctrl-C to stop.`);
});
