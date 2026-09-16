// Builds the three sheets. Contacts is the one people actually use, All Data
// keeps everything else so nothing gets dropped if my field matching misses
// something, and Summary is just counts.

(function () {
  const E = globalThis.SRExtract;

  const FIELD_PATTERNS = {
    gradYear: /(^|\.)(grad_?year|gradyear|class_?of|class_?year|graduation)/i,
    position: /(^|\.)(position|primary_?position|pos)$/i,
    club: /(^|\.)(club|club_?name|travel_?team|team_?name)/i,
    highSchool: /(^|\.)(high_?school|highschool|school_?name|school)/i,
    state: /(^|\.)(state|state_?code|region|province)$/i,
    city: /(^|\.)(city|town|hometown)$/i,
    phone: /(^|\.)(phone|mobile|cell|phone_?number)/i,
    gpa: /(^|\.)(gpa|grade_?point)/i,
  };

  const CONTACT_HEADERS = [
    "Name", "Email", "Other Emails", "Grad Year", "Position", "Club",
    "High School", "City", "State", "GPA", "Phone", "Instagram", "Profile URL",
  ];

  function profileUrl(flat) {
    const key = Object.keys(flat).find(
      (k) => /url|link|slug|permalink/i.test(k) &&
             typeof flat[k] === "string" &&
             /athlete|player|profile|recruit/i.test(flat[k])
    );
    if (key) {
      const v = String(flat[key]);
      return v.startsWith("http") ? v : "https://sportsrecruits.com" + (v.startsWith("/") ? v : "/" + v);
    }
    const id = flat.id ?? flat.athlete_id ?? flat.athleteId ?? flat.slug;
    return id ? `https://sportsrecruits.com/athlete/${id}` : "";
  }

  function toContactRow(raw) {
    const flat = E.flatten(raw);
    const emails = E.sweepEmails(raw);
    const igs = E.sweepInstagram(raw);
    return [
      E.guessName(flat),
      emails[0] || "",
      emails.slice(1).join(", "),
      E.guessField(flat, FIELD_PATTERNS.gradYear),
      E.guessField(flat, FIELD_PATTERNS.position),
      E.guessField(flat, FIELD_PATTERNS.club),
      E.guessField(flat, FIELD_PATTERNS.highSchool),
      E.guessField(flat, FIELD_PATTERNS.city),
      E.guessField(flat, FIELD_PATTERNS.state),
      E.guessField(flat, FIELD_PATTERNS.gpa),
      E.guessField(flat, FIELD_PATTERNS.phone),
      igs.length ? "@" + igs[0] : "",
      profileUrl(flat),
    ];
  }

  const PREFERRED_COL_RE = /(name|email|grad|class|position|club|school|city|state|gpa|phone|insta|twitter|url|slug|id)/i;

  /** Every key we saw across all records, useful ones first. */
  function allDataSheet(records, maxColumns) {
    maxColumns = maxColumns || 300;
    const flats = records.map((r) => E.flatten(r));
    const fill = new Map();
    for (const f of flats) {
      for (const k of Object.keys(f)) {
        if (f[k] === "" || f[k] === null || f[k] === undefined) continue;
        fill.set(k, (fill.get(k) || 0) + 1);
      }
    }
    const cols = [...fill.keys()]
      .sort((a, b) => {
        const pa = PREFERRED_COL_RE.test(a) ? 0 : 1;
        const pb = PREFERRED_COL_RE.test(b) ? 0 : 1;
        // useful names first, then whatever's most filled in
        return pa - pb || fill.get(b) - fill.get(a) || a.localeCompare(b);
      })
      .slice(0, maxColumns);

    const rows = [cols];
    for (const f of flats) {
      rows.push(cols.map((c) => {
        const v = f[c];
        if (v === null || v === undefined) return "";
        return typeof v === "object" ? JSON.stringify(v) : v;
      }));
    }
    return { name: "All Data", rows, columnCount: cols.length, droppedColumns: Math.max(0, fill.size - cols.length) };
  }

  function buildSheets(records, opts) {
    opts = opts || {};
    const contactRows = records.map(toContactRow);

    // put the ones with emails on top, those are the only usable rows
    contactRows.sort((a, b) => {
      const ea = a[1] ? 0 : 1, eb = b[1] ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return String(a[3]).localeCompare(String(b[3])) || String(a[0]).localeCompare(String(b[0]));
    });

    const allEmails = new Set();
    for (const r of records) for (const e of E.sweepEmails(r)) allEmails.add(e);

    const withEmail = contactRows.filter((r) => r[1]).length;
    const withIg = contactRows.filter((r) => r[11]).length;

    const byGrad = new Map();
    for (const r of contactRows) {
      const g = r[3] || "(unknown)";
      byGrad.set(g, (byGrad.get(g) || 0) + 1);
    }

    const all = allDataSheet(records, opts.maxColumns);

    const summary = [
      ["SportsRecruits export"],
      ["Generated", new Date().toLocaleString()],
      [],
      ["Recruits collected", records.length],
      ["Rows with an email", withEmail],
      ["Unique email addresses", allEmails.size],
      ["Rows with an Instagram handle", withIg],
      ["Columns in All Data", all.columnCount],
    ];
    if (all.droppedColumns) summary.push(["Sparse columns omitted", all.droppedColumns]);
    summary.push([], ["By grad year", ""]);
    for (const [g, n] of [...byGrad.entries()].sort()) summary.push([g, n]);

    return [
      { name: "Contacts", rows: [CONTACT_HEADERS, ...contactRows] },
      all,
      { name: "Summary", rows: summary },
    ];
  }

  globalThis.SRSheet = { buildSheets, toContactRow, CONTACT_HEADERS };
})();
