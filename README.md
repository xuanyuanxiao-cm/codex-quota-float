# Codex Quota Float

A compact floating Codex quota monitor for Windows.

![Codex Quota Float preview](assets/preview-expanded.png)

## Features

- Detect the signed-in plan on every startup and quota refresh. Show only weekly quota when a successful reading supplies a weekly window without a five-hour window; connection failures preserve the last confirmed layout. Historical five-hour data remains visible in trends when present in the selected time range.
- Reset messages: the single-line orb label shows the current verified event or `24h · XX%`. The cyan badge shows the number of unread related messages (99+ above 99). Opening, refreshing or restarting never acknowledges messages; use Mark read or Mark all read. Bulk acknowledgement applies only to the displayed revisions, leaving concurrent arrivals unread.
- Community 24-hour reset estimates use the [Codex Reset Observatory](https://github.com/gussuri/codex-reset-observatory) public API. The target is an extra reset or banked-reset distribution, not a new announcement or this account receiving quota. This replaces the uncalibrated local historical-frequency calculation. Active announcements take precedence over percentages; completed community events remain explicitly attributed to the community unless their execution is confirmed by the original post. Accuracy has not been independently validated by this app.
- Every 30 minutes, the main process requests the credential-free Codex Reset Observatory public API using Electron networking. Manual checks have a ten-minute minimum; after failures they can retry after 30 seconds, while automatic retry backs off to one hour. Unhealthy or six-hour-old forecasts are hidden; verified local event evidence remains available. This feed is not a complete Tibo timeline.
- Original Tibo posts are verified on demand using Firecrawl v2 scrape with `FIRECRAWL_API_KEY` from the app environment; never bundle a key. At most two posts are checked per poll, with new messages ahead of historical backfill. Related questions, denials, rules and Codex service apologies are messages without being treated as reset promises. Unrelated posts do not notify. Unreadable pages retry with backoff up to seven days; network failures do not reject content. Missing verification configuration leaves community records visibly unverified. Reply context unavailable from the source is never invented.
- History is retained without a 30-day/200-message deletion limit. The list defaults to the latest 30 days plus all unread messages, with an all-history filter and 50-row paging. Upgrade migration backs up version 2 and repairs the known September 27 missed teaser once. The bundled three-month archive is partial, source-linked and silent; summaries never masquerade as authenticated originals.
- Account card inventories use hashed account identities and card IDs for persistent comparisons. First inventories establish a baseline, unavailable inventories preserve it, and observed new cards create one persistent unread record. Account changes reconnect the CLI; an in-flight read crossing an identity change is rejected. An unknown identity disables cross-read arrival detection.
- Forecast snapshots preserve the original probability, upstream timestamp, observation time and model version when available. Only a subsequently observed, verified, broad completed event can establish a positive outcome. Missing or partial coverage remains unscorable rather than a false negative. No accuracy claim, local calibration, automatic card use or independent prediction model is added.
- Local seven-day quota history with a default automatic view of the latest concentrated usage session, plus fixed 24-hour / seven-day views. Thirty minutes of observed inactivity separates sessions; missing readings do not establish inactivity. Automatic bounds expand without shrinking during the same session and keep the latest session visible while idle. All views preserve real elapsed time and gaps; sampling remains every five minutes.
- Remaining-quota trends label the latest values, show 20% / 10% reference lines and before/after recovery values, and snap hover readings by screen distance without crossing gaps. The displayed date range identifies historical sessions explicitly.
- Follow Codex startup on Windows: the packaged app enables a hidden per-user watcher on first launch; it checks for a Codex desktop window every five seconds and starts the companion on the next opening. Toggle it in either context menu. Closing the companion manually does not immediately reopen it during the same Codex session.
- The startup watcher checks the Codex installation path (including Store builds whose executable is named ChatGPT.exe), not Codex CLI processes. The portable version remembers its outer executable path; keep that file in a stable location or run it once again after moving it. Disabling the setting removes the startup shortcut and ends the watcher within five seconds.
- Upper-right quota badge: yellow for remaining ≤20%, orange for ≤10%, red for exhaustion. Five-hour and weekly thresholds are tracked independently; the most urgent current state controls the shared badge and both windows appear in its text.
- Confirmed exhausted-to-positive recovery uses a green check only when all existing windows are above 20%; another low or exhausted window keeps its warning color. Missing readings cannot claim full recovery.
- Lower-right orange clock for available reset cards entering their final 24 hours; upper-left cyan numeric badge for unread related messages and observed new cards. The compact text panel disappears after 15 seconds or a successful refresh of the corresponding source, whichever occurs first. New threshold events, expiring cards and message revisions restart its timer; routine value changes and repeated unread records do not replay it.
- Hovering the orb shows a separate native plain-text tooltip containing current low quota, valid expiring cards and the unread message count. It hides the transient panel while hovered without pausing its timer or marking messages read. Empty status uses the usual click-for-details hint. The native tooltip does not expand the companion window or its hit region.
- Quota and card badges still clear on the next successful full refresh or when their respective details are opened. Text timeout does not dismiss badges. Push updates and failed reads do not dismiss them. New threshold events and new expiring cards may replace badges on that refresh. Current warnings and expiry dates remain in details and the orb tooltip.
- Threshold and card deduplication survives restarts. Unread announcements remain until explicitly marked read, including when automatic checks are paused. No desktop notifications, notification settings, sounds, or automatic reminder windows. Card consumption still requires confirmation.
- Refresh at upcoming quota reset, card-warning, and card-expiry boundaries, as well as the regular five-minute interval
- Five-hour quota displayed as a blue inner ring
- Weekly quota displayed as a purple outer ring
- Separate remaining percentages divided by a white rule
- Compact countdown and absolute reset-time display
- Always-on-top floating panel with manual refresh and reset controls
- Select a reset credit before confirming; the earliest-expiring available credit is preselected
- Manual refresh reconnects after startup or connection failures
- Each app-server request has a 15-second timeout; quota reads retain bounded retries, while reset consumption is never automatically replayed
- Reset completion always triggers a fresh quota and reset-card read; a reset timeout reports an unconfirmed result and asks you to refresh
- Window size follows the visible panel; blank corners and gaps are excluded from the native Windows hit region
- Closing the floating window hides it to the tray and keeps quota and trend updates running. Choose Exit in either context menu to stop the app.
- On short screens or at high display scaling, the details panel scrolls while the orb remains visible. The panel adapts when the display work area changes.

## Development

Install dependencies:

```powershell
pnpm install
```

Run tests:

```powershell
pnpm test
```

Run the Windows/Electron layout and transparency test with offline quota fixtures:

```powershell
pnpm test:window
pnpm test:window --force-device-scale-factor=1.25
pnpm test:alerts
pnpm test:trends
pnpm test:notices
pnpm test:regressions
```

Add `--interactive` to open a checkerboard behind the companion for native click-through checks. These tests never connect to the quota service or consume reset cards.

`test:regressions` checks scrolling at a 500-DIP work-area height, resizing back to a taller display, closing to tray, restoring the window, and shutdown cleanup. The unit suite also verifies quota responses while a child process writes a large volume of diagnostic output.

All active unit tests use `node:test` in `test/`. The old compiled Vitest tests have been migrated or consolidated with current coverage; see [test migration notes](test/README.md).

The alert test uses a real Electron window with offline quota data. It checks badge colors, independent dismissal, refresh lifecycle, native hit regions, and the absence of desktop notifications, and saves actual UI previews in `release/alerts-preview/`.

The trend test uses generated offline history to check automatic and fixed time ranges, gaps, recovery events, hover values, and the empty state. Real history starts with the first successful refresh; it cannot reconstruct earlier usage or estimate token counts / billing. Startup detection can be checked without registering anything using `powershell.exe -NoProfile -File dist/follow-codex.ps1 -Probe`.

Build the portable Windows executable:

```powershell
pnpm build
```

The portable executable and installer are generated in `release/` with the current version in their filenames.
