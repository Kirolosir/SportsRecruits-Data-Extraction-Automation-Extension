# SportsRecruits Export

A Chrome extension that pulls recruit contact info out of SportsRecruits search
results and exports it to Excel. Built for a college coach who was copying
emails off athlete profiles one at a time — the platform has 17,000+ of them.

<img src="docs/popup.png" width="560" alt="Extension popup in light and dark themes">

Set a target, hit start, export. Everything runs locally and is deleted once the
file is saved. Follows your system light/dark setting, with a toggle to override it.

## The interesting problem

I never had access to a SportsRecruits account, so I couldn't see a single API
endpoint or field name. Hardcoding either would have meant code that breaks the
first time it runs.

Two things fall out of that:

**It can't log in, so it doesn't.** A hosted site can't read someone's
logged-in session, and doing it server-side would mean storing their password.
The extension instead runs inside the tab they're already signed into. The page
is already downloading athlete data to render itself — `injected.js` wraps
`fetch` and `XMLHttpRequest` and reads those responses as they come back.

**It can't know the schema, so it infers it.** `lib/extract.js` scores objects
on the *kinds* of fields they carry rather than on specific names. Anything with
a name, or two other signals (grad year, position, club, email), is treated as a
person. Every string gets scanned for emails and Instagram links regardless of
what the key is called.

It also handles the wrapper problem — given
`{status, payload: {prospect: {personal: {...}}}}` it has to return the
prospect, not the payload around it or the `personal` object inside it.

## Output

Three sheets: **Contacts** (the usable list, emails sorted to the top),
**All Data** (every field, so nothing is silently dropped), and **Summary**.

![Exported contacts sheet](docs/export.png)

The `.xlsx` writer is hand-rolled — an xlsx is a zip of XML, and Manifest V3
blocks loading SheetJS from a CDN. Files are stored uncompressed so I didn't
have to implement deflate.

## Testing

No account meant no way to test against the real thing, so I wrote a mock site:
1,200 prospects, both pagination styles, `fetch` on some pages and `XHR` on
others, emails only on profile pages, and decoy objects designed to fool the
extractor.

![Mock test site](docs/test-site.png)

Field names in the mock deliberately differ from what the extractor was written
around — matching names would make the test prove nothing. It caught three real
bugs:

| Bug | Effect |
|---|---|
| `prospectId` not recognized as an ID | records fell back to content hashes and duplicated across pages |
| Single-object profile responses | extracted **zero** records — the finder only looked inside arrays, so profile fetching was a silent no-op |
| Both of the above together | profile emails never merged onto the matching search record |

Extraction is additionally verified against three third-party public APIs
(`jsonplaceholder`, `dummyjson`, `reqres`) — 46/46 records, three different
schemas, none of them mine.

```bash
node test-harness/server.js   # http://localhost:8787
```

## Where the data goes

Tab memory → Chrome's local extension storage → the `.xlsx` file. When the
download completes, `background.js` wipes the first two. The spreadsheet is the
only copy that survives.

Deletion lives in the service worker rather than the popup because Chrome
destroys the popup the moment the save dialog opens — a listener there never
fires. There is exactly one outbound request in the extension, and it goes to
SportsRecruits.

## Install

Chrome → Extensions → Developer mode → Load unpacked → select this folder.
Full walkthrough in [INSTALL.md](INSTALL.md).

## Status

Works end to end against the test harness. Not yet run against the live site —
the pagination heuristics in `content.js` are the part most likely to need
adjusting there.

Bulk collection may conflict with the platform's terms of service, and
SportsRecruits offers a native CSV export for followed athletes that covers some
of this. Camp outreach to mostly-minor recipients also falls under CAN-SPAM and
NCAA DIII contact rules.
