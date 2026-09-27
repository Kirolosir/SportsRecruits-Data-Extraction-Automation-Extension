# SportsRecruits live tests

## Stop and large-run update — September 27, 2026

**Final fresh-run result:** 100 recruits, 100 matched profiles, 100 direct athlete
emails, zero failures, and no manual retry. Completion was observed 251 seconds
after Start, so the run finished within 4½ minutes. Its automatic handoff opened
a fresh search tab, removed the original, preserved Uncommitted/2027 and the
saved tab group, restored the first 60 completed profiles, and continued through
the 80-profile threshold to all 100. This validates 100 live athletes; 500 is
covered by the synthetic tests rather than a live throughput claim.
`recruits-2026-09-27-batch-100.xlsx` independently verified all 100 direct emails
against their own athlete records and actual profile URLs, 58 text phones,
97 numeric GPA values, and 55 direct Instagram handles. Saving cleared the
collection to zero; the search was then reloaded with the same filters.

Discovery now indexes the mounted cards once, skips unchanged completed
records, and reuses its scroll-container lookup. Contact mutation scans are
coalesced and video handling inspects changed nodes instead of repeatedly
scanning the whole page. Each completed profile writes one checkpoint; the
full collection is saved at batch boundaries and on Stop. The worker retains
progress for an unresponsive popup, owns cancellation after the popup closes,
and reloads an unresponsive SportsRecruits tab after 2.5 seconds. Repeated Stop
requests share one cancellation. Late progress cannot re-enable the Stop
button while it is pending. Athlete matching and the 1.2-second settling period
remain intact. Complete normalized contact responses carrying a verified direct
athlete email can settle before unrelated page rendering finishes. Partial
schemas and missing direct emails still wait for rendered evidence or the full
timeout.

A fresh 100-athlete attempt exposed premature pagination at 40 despite more
site results. Scrolling now reaches the next-results marker immediately only
when every mounted card's actual href has already been captured. Unknown rows
keep overlapping viewport steps. New mounted indices extend the finite travel
allowance, and a visible site spinner receives a bounded wait.

The next live collection reached all 100 recruits, initially with 92 matched
profiles and eight capture failures. The overnight interruption makes its total
time unusable as a speed benchmark. Retrying reached 96 emails; live Stop during
that retry retained all 100 recruits and 96 emails. A fresh search tab restored
that checkpoint after the older SportsRecruits page stopped responding. Retrying
the remaining profiles finished with **100 matched profiles, 100 direct athlete
emails, zero failures**. The exported workbook has 100 unique IDs and actual
profile URLs, 2027 on all rows, 58 player phones stored as text, 97 numeric GPA
values matching `gpa.value`, and 55 direct Instagram handles. Saving cleared the
collection to zero. The workbook is saved in Downloads as
`recruits-2026-09-27-verified-100.xlsx`.

The earlier 99-athlete recovery also finished with 99 matched profiles and 99
direct emails, zero failures; its saved workbook was independently checked.
The **95 automated checks** passed, including synthetic 500-athlete identity
matching, bounded work, incremental restore/purge, safe scrolling, responsive
and hung-tab Stop, duplicate cancellation and late progress during Stop.
These checks do not establish 500 live athletes or multi-year behavior.

A subsequent clean 100-athlete run reproduced slow profile loading after 80.
It finished with 98 matched profiles and two explicit mismatch/capture failures;
the diagnostic workbook preserves them. Chrome reported roughly 6.5 GB for the
search page afterward. Repeated scanning reductions alone did not resolve that
accumulated page load. Collection now checkpoints and opens a fresh tab in place
of the old one after about 60 checked profiles, with no active managed frames remaining, then
restores contacts and continues discovery using the exact filter URL. Its
continuation expires after one minute and Stop cancels it. A denied refresh
stops safely with data retained. The synthetic 500-athlete test now crosses
multiple such continuations rather than bypassing the refresh behavior.
The replacement keeps the saved group by joining it before the old tab closes.
Stop follows a pending/completed transfer, including after a worker restart.
The same-tab reload variant was tested live and continued to 100 profiles,
but accumulated page load and two failed captures remained. That earlier result
is not a speed claim for the final implementation; the fresh-tab result above
is the final live check.

After loading the current code, a restored collection retried its two unfinished
profiles and reached 100 matched profiles, 100 direct emails and zero failures.
`recruits-2026-09-27-final-100.xlsx` was independently verified with the same
100 unique IDs/URLs, 58 text phones, 97 numeric GPA values, and 55 direct
Instagram handles. Successful saving again cleared the collection to zero.

## Five-athlete live test

Authenticated live test: September 26, 2026. Manual Uncommitted and 2027 filters
produced five distinct test athletes. All five actual profile hrefs loaded in
managed hidden frames, intercepted athlete data matched, and emails merged.
Successful saving cleared the popup to zero. Stop removed the active managed
frame, and restarting began a fresh five-athlete collection.

Final Excel verification confirmed five unique athlete IDs/profile URLs, 2027
on every Contacts row, each primary Email matching that athlete's direct
`emailAddress`, and success/email_found diagnostics for all five. Contacts,
All Data and Summary were retained. The final rerun again matched five profiles
with zero failures, and saving left zero records and zero managed frames.
The 33 regression checks also passed, including mismatched payloads, cancelled
downloads and deletion after a service-worker restart. No live cancelled-save
test was performed.

The site required two concrete fixes discovered during inspection:

- Result rows use `data-card-index` and separate firstname/lastname spans. The
  nested `card-head` contains the name but not the View Profile link.
- The `/api/v2/resources/athletes/ID` basics response uses
  `root: {type: "athletes", id}` with `resources.athletes[ID]`. Its map key is
  the athlete ID. The body contains direct `emailAddress`, and guardian contacts
  are separate resources linked by `{type, id}` references.

The player's direct email precedes coach/guardian emails in Contacts. The
existing All Data limit is 300 columns; status and reason are prioritized and
Summary reports omitted fields.

## Speed and formatting update — September 26, 2026

The popup now defaults to 500 athletes, with a configurable 1–10,000 limit.
Phones are explicit text with a 24-character column width; GPA uses `gpa.value`
and a two-decimal format. A missing athlete phone stays blank, rather than
using a coach/guardian phone. Overlapping viewport scrolling captures middle
virtualized cards. Two profile workers run at a time. Only a matched normalized
response carrying all three contact fields (`emailAddress`, `phoneNumber`, `gpa`)
and child DOM readiness uses a 1.2-second settle window; partial schemas retain
15 seconds. The 68 automated checks passed, including 500 correlated athletes,
out-of-order replies, 100 virtualized cards, early completion, cancellation,
leading-zero/international/missing phones and numeric GPA. The generated
500-row workbook was imported and its phone/GPA, names/emails, All Data and
Summary views visually checked.

The stalled 180-athlete run was recovered after these changes. Discovery now
pauses every 20 pending athletes to collect contacts, uses a finite scroll
allowance for loaded video cards plus eight quiet ticks without new athletes,
and ignores unchanged DOM
email scans when settling a completed profile. An unfinished collection survives
extension reloads, and **Collect emails for these athletes** preserves completed
contacts while retrying pending/failed profiles.

The recovery completed 179 matched profiles/direct athlete emails and 106
Instagram handles. One athlete, Graham Robinson, remained flagged
`no_profile_capture_iframe_blocking_unknown` after retrying; opening its actual
profile manually showed available contact information. The workbook therefore
retains an explicit capture failure rather than claiming that no email exists.
Its 180 rows have unique athlete IDs and actual profile URLs. Independent XML
checks confirmed all 179 direct emails, all 106 player phone values as text,
175 numeric GPA values matching `gpa.value`, 106 direct Instagram handles, and
2027 for all matched profiles. Contacts phone/GPA columns were imported and
visually checked. Saving cleared the popup and local collection to zero.

The recovery was interrupted for updates, so its timing is not a clean fresh-run
benchmark. It does not establish 500 live athletes or multi-year behavior.
Filters remain manual. Keep the search tab active while collecting.

## Follow-up 40-athlete check

The initial streaming test showed 20 discovered athletes and eight emails at
22 seconds, before reaching its 40-athlete target. It then stopped prematurely
at 30 because eight viewport steps were insufficient to traverse tall video
cards. The finite travel allowance corrected that: discovery reached all 40.

The page also accumulated video players and became sluggish. Managed hidden
profile pages now omit the observed video embed; active collection pauses search
previews and restores their real URLs with lazy loading on Stop/finish/purge.
No other frames are paused. The test was checkpointed at 40 athletes/20 emails,
the overloaded test tab was reopened, and the remaining profiles resumed.

The final result was **40 matched profiles, 40 direct athlete emails, zero
failures**. The exported workbook independently verified 40 unique athlete IDs
and actual profile URLs, 2027 on every row, 22 player phone values stored as
text, 39 numeric GPA values matching `gpa.value`, and 20 direct Instagram
handles. Export completion cleared the popup and collection to zero. The
temporary verification workbook is outside the repository. These interrupted
tests do not provide a clean speed benchmark or establish 500 live athletes.

## Run

1. Reload SportsRecruits Export in `chrome://extensions`, then reload the search
   tab so both interception scripts start before the page requests data.
2. Open the search tab's DevTools. In Console enable **Preserve log**. In Network
   enable **Preserve log** as well; both the search and profile requests matter.
3. Manually select **Uncommitted**, expand **Academic**, and check **2027** under
   **Class Year**. Confirm both filter chips. Wait until results finish
   loading. Do not change the filters during collection.
4. Open the popup, set **Maximum athletes this run** to **5**, and press **Start collecting**. It starts fresh, selects up to
   five distinct current visible results, then captures each real profile URL in
   a hidden iframe. Up to two run at a time, with a 15-second maximum per profile
   or earlier completion after verified contact fields settle. Time this run to
   compare against the earlier approximately 75-second sequential profile phase.
5. Verify the count is exactly **5**. A lower count is an incomplete test and
   should be investigated before expanding the run.
6. Export. In Contacts, verify the athlete name, Email/Other Emails and Profile
   URL refer to the same athlete. In All Data inspect `_srProfileStatus` and
   `_srProfileReason`. Five distinct search athletes must produce five rows.
7. Verify successful saving clears the popup count and collection data. In a
   separate disposable test, Stop should remove the active hidden iframe and
   prevent further merges; Delete should also clear records and pending saves.
   Cancelling Save must retain the records.

No available email is guaranteed. Profile success means athlete data matched and
merged, whether or not that captured data contained an email.

## Expected Console output

`DEBUG` defaults to `false` in `content.js`; set it to `true` and reload the
extension/search tab only for troubleshooting. Filter Console by `SRExporter` for extension
messages. For each athlete, expect:

```text
[SRExporter] Search athlete discovered: NAME / ID
[SRExporter] Profile URL discovered: https://sportsrecruits.com/ACTUAL_PATH
[SRExporter] Loading profile: NAME
[SRExporter] Profile payload received: NAME
[SRExporter] Profile payload matched athlete: NAME
[SRExporter] Emails found: ["address@example.com"]
[SRExporter] Profile merged: NAME
```

There may be multiple received/matched messages during the capture window.
The logged profile URL omits its query and fragment. Requests, cookies, headers,
tokens and full response bodies are not logged by the extension.

If matching succeeds but no email is captured:

```text
[SRExporter] Emails found: []
[SRExporter] Profile loaded but no email found for NAME (captured payloads and rendered mailto links)
[SRExporter] Profile merged: NAME
```

Other outcomes are recorded separately:

| All Data reason | Meaning |
|---|---|
| `profile_url_not_discovered` | No unambiguous supplied profile URL/href was found. |
| `no_stable_athlete_id` | URL exists but there is no stable ID for strict matching. |
| `unexpected_profile_page` | Browser reports a different page URL, such as a login redirect. Legitimate redirects need live inspection. |
| `profile_page_load_failed` | Frame insertion/navigation reported an error. |
| `iframe_blocked_by_parent_csp` | A matching parent `frame-src`/`child-src` violation was observed. |
| `profile_loaded_no_payload` | Child content script reached DOM readiness but captured no JSON payload. |
| `no_profile_capture_iframe_blocking_unknown` | No managed-frame capture/readiness reached the top frame. Blocking, missing injection and load failure cannot be distinguished locally. |
| `payload_athlete_mismatch` | Athlete-like payloads arrived but none matched the expected athlete. |
| `payload_has_no_matching_athlete` | JSON arrived but extraction returned no matching athlete. |
| `payload_parse_or_extraction_failed` | Parsing/extraction threw. |
| `email_extraction_failed` | Scanning the merged record threw. |
| `profile_matched_no_email_found` | Matching athlete data merged, but no email appeared in the captured data or mailto links. |
| `email_found` | Matched profile merged and the resulting record contained an email. |
| `stopped_before_profile_completed` | Stop cancelled the unfinished profile. |

An iframe's `load` event cannot establish success or detect X-Frame-Options.
The extension does not infer child `frame-ancestors` or X-Frame-Options blocking
from a timeout. Chrome's own Console and Network can provide that evidence.
No CSP bypass or undocumented route is used.

## Exact evidence to provide when a stage fails

Keep the test at five athletes and the same manual filters.

- **Zero/fewer than five, or missing URLs:** Provide a screenshot showing the
  selected filters and one whole athlete result card, including View Profile.
  In DevTools Elements select that athlete's **whole card/container**, then
  right-click → Copy → Copy outerHTML. Also provide the actual View Profile
  element's outerHTML. Alternatively, with that element selected, Console
  `copy($0.outerHTML)` copies it. If View Profile is a button with no href,
  provide its HTML and the actual browser destination after manually opening it.
- **JSON/card association:** In Network, find the Fetch/XHR response used to draw
  the filtered search results. Provide the request's origin/path, the response
  wrapper structure and one complete athlete object corresponding to that card,
  including its ID, name and URL/path/href fields. No cookies, auth headers,
  session query parameters or tokens are needed.
- **Profile loading/capture:** Provide all `[SRExporter]` messages for one failed
  athlete and Chrome's adjacent iframe/CSP/X-Frame-Options errors. In Network,
  inspect that profile's **Document** request: status, actual/final origin/path,
  redirects, `Content-Security-Policy`, and `X-Frame-Options`. These show whether
  the site allows this iframe approach; iframe blocking will require evaluating
  a normal browser-tab approach, without bypassing site protections.
- **Payload mismatch or no email despite visible contact info:** Manually open
  the same athlete's actual profile. Provide the profile Fetch/XHR request
  origin/path and the response wrapper plus the relevant athlete/contact object,
  including identity fields. If the page renders an email link, provide that
  `mailto:` element's outerHTML and its enclosing contact section. If contact
  info appears only after clicking a tab/button, provide a screenshot showing
  that control and describe the manual action that reveals it.
- **Export association:** Provide the affected Contacts row and its corresponding
  All Data ID, `_srProfileStatus`, `_srProfileReason`, and discovered profile URL.
  A contact address can be replaced consistently with a placeholder for debugging.

Do not send a full HAR, cookies, authorization headers or session tokens. The
specific structure and identity fields above are enough to diagnose the failing
stage without inventing the live schema.
