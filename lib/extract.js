// Pulls athletes out of whatever JSON the site sends back.
// I never got to see the real API, so none of this can depend on specific field
// names. Instead it looks for objects that seem like a person and scans every
// string it finds for emails and Instagram links, whatever the keys are called.

(function () {
  const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  const IG_URL_RE = /instagram\.com\/([A-Za-z0-9._]{1,30})/gi;
  const IG_AT_RE = /^@([A-Za-z0-9._]{1,30})$/;
  const IG_STOPWORDS = new Set(["p", "reel", "reels", "explore", "stories", "tv", "accounts", "direct"]);

  // site emails that show up in footers etc, not actual recruits
  const EMAIL_BLOCKLIST = /^(support|help|info|noreply|no-reply|donotreply|admin|webmaster|privacy|legal|sales|contact)@/i;

  function walkStrings(obj, keyPath, visit, depth) {
    depth = depth === undefined ? 0 : depth;
    if (depth > 12 || obj === null || obj === undefined) return;
    if (typeof obj === "string") { visit(keyPath, obj); return; }
    if (typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      for (const v of obj) walkStrings(v, keyPath, visit, depth + 1);
    } else {
      for (const k of Object.keys(obj)) {
        walkStrings(obj[k], keyPath ? keyPath + "." + k : k, visit, depth + 1);
      }
    }
  }

  function sweepEmails(obj) {
    const found = [];
    walkStrings(obj, "", (_k, s) => {
      const m = s.match(EMAIL_RE);
      if (!m) return;
      for (let e of m) {
        e = e.toLowerCase().replace(/\.$/, "");
        if (!EMAIL_BLOCKLIST.test(e) && !found.includes(e)) found.push(e);
      }
    });
    return found;
  }

  function sweepInstagram(obj) {
    const found = [];
    const add = (h) => {
      h = String(h).trim().replace(/\.$/, "").toLowerCase();
      if (h && !IG_STOPWORDS.has(h) && !found.includes(h)) found.push(h);
    };
    walkStrings(obj, "", (k, s) => {
      let m;
      IG_URL_RE.lastIndex = 0;
      while ((m = IG_URL_RE.exec(s)) !== null) add(m[1]);
      // only treat @something as a handle if the key looks social, otherwise
      // the front part of an email address gets picked up as one
      if (/insta|social|handle|ig_|_ig\b/i.test(k)) {
        const at = s.trim().match(IG_AT_RE);
        if (at) add(at[1]);
      }
    });
    return found;
  }

  /** Flattens nested JSON to {"a.b[0].c": value} so each field can be a column. */
  function flatten(obj, prefix, out, depth) {
    out = out || {};
    prefix = prefix || "";
    depth = depth === undefined ? 0 : depth;
    if (depth > 8) { out[prefix || "_"] = JSON.stringify(obj).slice(0, 2000); return out; }

    if (obj === null || obj === undefined) { if (prefix) out[prefix] = ""; return out; }
    if (typeof obj !== "object") { if (prefix) out[prefix] = obj; return out; }

    if (Array.isArray(obj)) {
      if (obj.length && obj.every((x) => x === null || typeof x !== "object")) {
        out[prefix] = obj.map((x) => (x === null ? "" : String(x))).join(", ");
      } else {
        obj.slice(0, 25).forEach((v, i) => flatten(v, prefix + "[" + i + "]", out, depth + 1));
      }
      return out;
    }
    for (const k of Object.keys(obj)) {
      flatten(obj[k], prefix ? prefix + "." + k : k, out, depth + 1);
    }
    return out;
  }

  /** Finds every array of objects in a payload. */
  function findRecordLists(obj, path, out, depth) {
    out = out || [];
    path = path || "";
    depth = depth === undefined ? 0 : depth;
    if (depth > 10 || obj === null || typeof obj !== "object") return out;

    if (Array.isArray(obj)) {
      const dicts = obj.filter((x) => x && typeof x === "object" && !Array.isArray(x));
      if (dicts.length) out.push({ path: path || "$", records: dicts });
      obj.slice(0, 3).forEach((v, i) => findRecordLists(v, path + "[" + i + "]", out, depth + 1));
    } else {
      for (const k of Object.keys(obj)) {
        findRecordLists(obj[k], path ? path + "." + k : k, out, depth + 1);
      }
    }
    return out;
  }

  // --- figuring out what's a person ---
  // Search results come back as a list, profile pages come back as one object,
  // and the field names are different either way. So instead of matching exact
  // keys I give each object a score based on what kinds of fields it has.

  const NAME_KEY_RE  = /(^|[._])(first|last|full|given|family|display)_?name|(^|[._])name$|surname/i;
  const GRAD_KEY_RE  = /grad|class_?(of|year)|classyear|graduation|hs_?class/i;
  const POS_KEY_RE   = /position|jersey|recruit/i;
  const ORG_KEY_RE   = /club|team|high_?school|school|academy|program/i;
  const EMAIL_KEY_RE = /e_?mail/i;

  /** Keys of the object plus one level down. One level is enough to catch
   *  personal.givenName, and any deeper starts matching the whole response. */
  function shallowKeys(dict) {
    const keys = [];
    for (const k of Object.keys(dict)) {
      keys.push(k);
      const v = dict[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const k2 of Object.keys(v)) keys.push(k + "." + k2);
      }
    }
    return keys;
  }

  /** Needs a name, or two other signals. One email on its own isn't enough -
   *  that's how things like support: {email: ...} kept getting picked up. */
  function looksLikePerson(dict) {
    if (!dict || typeof dict !== "object" || Array.isArray(dict)) return false;
    const keys = shallowKeys(dict);
    const hit = (re) => keys.some((k) => re.test(k));
    if (hit(NAME_KEY_RE)) return true;
    let score = 0;
    if (hit(GRAD_KEY_RE)) score++;
    if (hit(POS_KEY_RE)) score++;
    if (hit(ORG_KEY_RE)) score++;
    if (hit(EMAIL_KEY_RE)) score++;
    return score >= 2;
  }

  const dictChildKeys = (d) =>
    Object.keys(d).filter((k) => d[k] && typeof d[k] === "object" && !Array.isArray(d[k]));

  const hasArrayOfObjects = (d) =>
    Object.values(d).some(
      (v) => Array.isArray(v) && v.some((x) => x && typeof x === "object" && !Array.isArray(x))
    );

  /**
   * Returns the outermost objects that look like people.
   * Works for both a list response and a single profile. The tricky part is
   * wrappers like {status, payload: {prospect: {...}}} - you want the prospect,
   * not the payload around it and not the `personal` object inside it.
   */
  function collectPeople(node, out, depth) {
    out = out || [];
    depth = depth || 0;
    if (depth > 12 || !node || typeof node !== "object") return out;

    if (Array.isArray(node)) {
      for (const v of node) collectPeople(v, out, depth + 1);
      return out;
    }

    // if it holds a list of objects it's a container, keep going down
    if (!hasArrayOfObjects(node) && looksLikePerson(node)) {
      const kids = dictChildKeys(node);
      // wrapper with one child, like {payload: {prospect: {...}}} - use the child
      if (kids.length === 1 && looksLikePerson(node[kids[0]])) {
        return collectPeople(node[kids[0]], out, depth + 1);
      }
      out.push(node);
      return out;
    }

    for (const v of Object.values(node)) collectPeople(v, out, depth + 1);
    return out;
  }

  /** Main entry point - give it a response, get back the athletes. */
  function extractAthletes(payload) {
    return collectPeople(payload, [], 0);
  }

  const ID_KEYS = ["id", "athlete_id", "athleteId", "uuid", "slug", "profile_id", "profileId", "pk", "user_id", "userId"];

  function hashString(s) {
    // FNV-1a, just needs to be consistent for deduping
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
  }

  /** Finds the record's id, whatever the site decided to name it. */
  function recordId(rec) {
    if (!rec || typeof rec !== "object") return "";
    for (const k of ID_KEYS) {
      if (rec[k] !== undefined && rec[k] !== null && rec[k] !== "") return String(rec[k]);
    }
    // fall back to any key ending in id - prospectId, memberId, whatever
    const k = Object.keys(rec).find(
      (k) => /(^|_)id$|[a-z]Id$/.test(k) &&
             ["string", "number"].includes(typeof rec[k]) &&
             String(rec[k]) !== ""
    );
    return k ? String(rec[k]) : "";
  }

  /** Key for deduping, so seeing the same athlete twice updates instead of adds. */
  function recordKey(rec) {
    const id = recordId(rec);
    if (id) return "id:" + id;
    const emails = sweepEmails(rec);
    if (emails.length) return "email:" + emails[0];
    return "h:" + hashString(JSON.stringify(rec));
  }

  // anything under these belongs to a club or school, not the athlete
  const ORG_CONTEXT_RE = /(club|school|team|org|organization|coach|parent|guardian|highschool|high_school|college|program|event|camp)/i;

  const depthOf = (k) => (k.match(/\./g) || []).length;

  /**
   * Matching keys, best first. Shallower wins, and anything nested under a club
   * or school gets pushed down - otherwise club.name beat first_name and every
   * athlete came out named after their team.
   */
  function rankedKeys(flat, re) {
    return Object.keys(flat)
      .filter((k) => re.test(k))
      .filter((k) => {
        const v = flat[k];
        return v !== null && v !== undefined && String(v).trim() !== "";
      })
      .map((k) => {
        const parent = k.includes(".") ? k.slice(0, k.lastIndexOf(".")) : "";
        return { k, depth: depthOf(k), org: ORG_CONTEXT_RE.test(parent) ? 1 : 0 };
      })
      .sort((a, b) => a.org - b.org || a.depth - b.depth)
      .map((x) => x.k);
  }

  function guessField(flat, re) {
    const keys = rankedKeys(flat, re);
    return keys.length ? String(flat[keys[0]]).trim() : "";
  }

  /** Best guess at the athlete's name. */
  function guessName(flat) {
    const full = guessField(flat, /(^|\.)(full_?name|display_?name|athlete_?name|name)$/i);
    const first = guessField(flat, /(^|\.)(first_?name|firstname|given_?name)$/i);
    const last = guessField(flat, /(^|\.)(last_?name|lastname|family_?name|surname)$/i);

    const combined = [first, last].filter(Boolean).join(" ");
    // trust first + last over a single `name` field, since that one might
    // belong to some nested object instead of the athlete
    if (first && last) return combined;
    if (full) return full;
    return combined;
  }

  globalThis.SRExtract = {
    flatten, findRecordLists, extractAthletes, recordKey, recordId,
    sweepEmails, sweepInstagram, guessName, guessField, looksLikePerson,
    EMAIL_RE,
  };
})();
