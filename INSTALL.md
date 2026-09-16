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
2. Run a search for the recruits you want (grad year, position, region —
   whatever filters you'd normally use).
3. Click the **SportsRecruits Export** icon in your toolbar.
4. Type how many recruits you want, e.g. `1000`.
5. Click **Start collecting**.

Now leave the tab alone and let it work. It scrolls the results and loads more
on its own. The counter shows progress. It's fine to switch to another Chrome
tab, but don't close the SportsRecruits tab.

6. When it stops, click **Export to Excel** and choose where to save the file.

The spreadsheet has three tabs:

- **Contacts** — the clean list: name, email, grad year, position, club,
  school, Instagram. Recruits with an email are sorted to the top.
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

**The counter stays at 0** — Scroll the results list down by hand a little,
then click Start again. The extension needs the page to load some results
before it can pick anything up.

**It stops early** — That usually means the search genuinely ran out of
results. Try a broader search, or run several searches and export each one.

**More detail per recruit** — Open any one athlete's profile, go back to the
search, then click the icon. If a button appears saying "Also pull profile
details", click it and the extension will fill in the extra fields for
everyone it collected. This is slower — roughly one recruit per second.
