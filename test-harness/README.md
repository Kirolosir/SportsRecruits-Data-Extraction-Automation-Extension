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
