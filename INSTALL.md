# SportsRecruits Export — Setup

One-time setup, about two minutes. Nothing to download or install beyond the
folder you already have. You will not need to type any commands.

## Part 1 — Add it to Chrome (once)

1. Open Chrome.
2. Click the **⋮** menu (top right) → **Extensions** → **Manage Extensions**.
3. Turn on **Developer mode** using the switch in the top-right corner.
4. Click **Load unpacked** (top left).
5. Select the **sportsrecruits-exporter** folder and click **Select**.
6. You should now see "SportsRecruits Export" in your extension list.

To keep it handy: click the puzzle-piece icon in Chrome's toolbar, find
"SportsRecruits Export", and click the pin so its icon stays visible.

That's it. You never have to do this again.

## Part 2 — Using it

1. Log into SportsRecruits the way you normally do.
2. Go to the search page.
3. On SportsRecruits itself, select **Uncommitted**. Expand **Academic**, then
   check your desired year under **Class Year**. Confirm both filter chips appear.
4. Wait for the filtered athletes to appear.
5. Click the **SportsRecruits Export** icon. Choose **Maximum athletes this run**
   (default **500**; use **5** for a quick check), then **Start collecting**.

It collects up to the chosen limit and checks individual profiles automatically.
Start replaces any previous collection. Keep the search tab active and its filters
unchanged. Discovery pauses every 20 waiting athletes to collect their emails.
Search video previews pause during collection and return afterward with lazy loading.
Two profiles run at a time; complete matched contacts finish sooner,
while incomplete responses keep a 15-second timeout. **Stop** cancels active and
queued work and keeps collected athletes. Click **Collect emails for these
athletes** to finish/retry their profiles without starting over. Collection may
stop below your limit if repeated discovery attempts find no new athletes.

6. When it stops, review the collected count and matched/failed profile summary.
   For a five-athlete check, confirm all five profiles matched before a large run.
7. Click **Export to Excel** and choose where to save the file.

See [docs/LIVE_TEST.md](docs/LIVE_TEST.md) for the expected logs and evidence to
provide if URLs, profile capture or emails fail.

The spreadsheet has three tabs:

- **Contacts** — the clean list: name, email, grad year, position, club,
  school, GPA, phone, Instagram. Phones preserve zeros and country prefixes;
  GPA has two decimal places. Recruits with an email are sorted to the top.
- **All Data** — every field that came through, in case you want something
  the Contacts tab didn't pick up.
- **Summary** — totals and a breakdown by grad year.

## About the "delete after export" behavior

As soon as the file is saved, everything the extension collected is erased.
The spreadsheet on your computer is the only copy. Nothing is ever sent to a
website or server — it never leaves your laptop.

If you want to erase it sooner, click **Delete all collected data now**.

If Chrome restarts before you export, collected data is cleared automatically
and you'll need to run it again.

## If something doesn't work

**"Open a SportsRecruits search page first"** — You're on a different site or
tab. Switch to the SportsRecruits tab and click the icon again.

**"Reload the SportsRecruits tab, then try again"** — The page was already open
when you installed the extension. Press Cmd-R (Mac) or Ctrl-R (Windows) to
reload, then try again.

**A reload message appears, or progress still shows an old five-athlete run** —
Stop/export the current run if needed, reload SportsRecruits Export in Chrome's
Extensions page, and then reload SportsRecruits. Open the popup and set the
maximum to **500** (or your desired size) before starting a fresh run. Progress
shows how many collected profiles have been checked and the chosen batch limit.

**Stop shows “Stopping…”** — Stop keeps your collected athletes. If the page
doesn't answer within 2.5 seconds, the extension reloads it to end the stuck
work and restores saved results. You can close the popup while it stops. Then
use **Collect emails for these athletes** to retry unfinished profiles, or export
the saved collection. Start collecting begins a new collection.

**A fresh search tab replaces the old one during collection** — This is
automatic after about 60 profile checks to release accumulated page load. The
same filters, recruits, completed emails and saved tab group are kept, and
collection continues. The popup may close during the transfer; reopen it from
the new search tab to see progress. Stop follows the replacement tab. Keep the
search tab active.

**The counter stays at 0** — Reload the extension and search tab, select filters
again, wait for results, and press Start. If it still stays at zero, provide the
result-card HTML and search response described in the live-test guide.

**It stops early** — There may be fewer results, or the generic card association
may not fit the live site. Keep the same test filters and provide the evidence in
the live-test guide. After export/deletion, Start again and manually reload the
results to let the page send a fresh list.
