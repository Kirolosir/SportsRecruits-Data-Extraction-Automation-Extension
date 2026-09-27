# Test harness

A fake SportsRecruits-style search site, so the extension can be tested end to
end without an account.

```bash
node test-harness/server.js
```

Then open <http://localhost:8787>.

## What it simulates

- 1,200 prospects, 25 per page
- Both pagination styles: a **Load more** button *and* infinite scroll
- Both request styles: `fetch` on even pages, `XMLHttpRequest` on odd ones
- Responses wrapped in realistic noise, including decoys the extractor must
  ignore (a nav array, a `pagination` object, a `support@` address)
- **Emails only on the profile endpoint**, never in search results — the
  common real-world case, and what makes the "pull profile details" path
  worth testing
- ~15% of prospects have no email at all
- ~33% have an Instagram link
- Field naming (`prospectId`, `personal.givenName`, `classYear`,
  `contactInfo.emailAddress`) deliberately differs from the names the
  extractor was written against, so the test is not self-confirming

## Bugs this harness already caught

1. `prospectId` was not recognised as an identifier, so records fell back to
   content hashes and duplicated across pages.
2. Single-object profile responses extracted **zero** records — the finder only
   looked inside arrays, so the entire detail-fetch feature was a silent no-op.
3. As a consequence, profile data never merged onto the matching search record.

## Before giving the extension to the coach

Remove the test-only localhost access:

1. In `manifest.json`, delete the three `"http://localhost:8787/*"` entries
   (one in `host_permissions`, one in each `content_scripts` block).
2. In `popup.js`, change `SR_HOST` back to `/(^|\.)sports?recruits\.com$/i`.

## Regression checks

Run `node test-harness/test-unit.js`. The 95 checks use content-script messages,
controlled timers and mocked Chrome APIs. They cover athlete/frame correlation,
late/partial contact responses, failure reasons, cancellation/deletion, download
worker restarts, 100 virtualized cards, and a 500-athlete batch with out-of-order
replies and at most two concurrent profile frames. New cases cover email collection before discovery completes, endless scroll
without new records, tall video pages requiring more than eight scroll steps,
profile resume preserving existing athletes and completed
emails, storage across extension updates, bare Instagram handles, and omitting
video embeds inside managed hidden profiles, and pausing/restoring search video
previews during collection without touching unrelated frames.
Complete normalized contacts
finish after a settle period; partial responses retain the full timeout.
Additional checks cover one card-index scan for 500 athletes, coalesced widget
mutations, per-profile checkpoints and restore/purge, safe jumps across already
captured cards, renderer-independent Stop recovery, duplicate Stop requests,
and late progress arriving while Stop is pending.
The 500-athlete test crosses multiple automatic checkpoint refreshes and
preserves every athlete/email match. Refresh failures retain data, Stop during
restoration prevents continuation, expired markers remain idle, and the worker
checks the exact saved URL/token before replacing the tab. Additional cases
preserve the saved group and route Stop through a pending/completed tab transfer,
including after a worker restart. Complete verified direct contacts retain their
settle period without waiting for unrelated page rendering; missing emails keep
the rendered-evidence wait.

Workbook fixtures `/tmp/sr-exporter-regression.xlsx` and
`/tmp/sr-exporter-batch.xlsx` exercise text phones, numeric GPA, widths and filters.
Mock timings are not live speed measurements. Use the popup limit **5** and
[the live-test guide](../docs/LIVE_TEST.md) for an authenticated small check.
Filters on the mock page are illustrative; they do not filter its generated data.
