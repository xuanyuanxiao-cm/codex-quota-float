# Codex Quota Float

A compact floating Codex quota monitor for Windows.

![Codex Quota Float preview](assets/preview-expanded.png)

## Features

- Detect the signed-in plan on every startup and quota refresh. Show only weekly quota when a successful reading supplies a weekly window without a five-hour window; connection failures preserve the last confirmed layout. Historical five-hour data remains visible in trends when present in the selected time range.
- Reset announcements: the orb label and detail window distinguish community reports, locally verified original posts, announcements, completed resets, and reset-card distributions. Reading a post only clears that post's unread badge; it never changes the announcement state. Newly arriving posts remain unread while an older post is selected. Account status starts expanded, history starts collapsed, and refresh preserves manual expansion.
- Community 24-hour reset estimates use the [Codex Reset Observatory](https://github.com/gussuri/codex-reset-observatory) public API. The target is an extra reset or banked-reset distribution, not a new announcement or this account receiving quota. This replaces the uncalibrated local historical-frequency calculation. Active announcements take precedence over percentages; completed community events remain explicitly attributed to the community unless their execution is confirmed by the original post. Accuracy has not been independently validated by this app.
- Every ten minutes, the main process sends a credential-free GET to `https://codex.gussuriworks.com/api/current?locale=en` using Electron's system-proxy-aware network stack. No account data, login tokens or API keys are sent to this endpoint. Validate `public-v1`, upstream timestamps, health flags and 0–1 probability units. Network errors, unhealthy sources and data older than six hours hide the percentage; retained posts remain available. Failures back off to at most hourly checks; manual checks also respect the ten-minute minimum. Polling only runs while the app is open and can be disabled.
- Original Tibo posts are verified on demand using Firecrawl v2 scrape with `FIRECRAWL_API_KEY` from the app's environment; never bundle a key in an installer. Without this optional key, community estimates and reports still work but are never presented as locally verified or used for verified-announcement notifications. Website collection consumes Firecrawl credits; each check verifies at most two recent posts. Temporary request failures retry with a bounded backoff, while unrecognized page layouts stop after three attempts. A bounded rule classifier rejects conditional, negative, explanatory and unrelated reset text; ambiguous originals stay unconfirmed.
- First synchronization is silent; verified new posts are deduplicated across restarts. Keep 30 days / 200 posts, with separate collection, original-verification and account timestamps. Old-version history and display preferences survive migration, but old classifications are reverified. Account card arrivals use observed new available-card IDs; first or missing readings never invent an arrival. Card arrival, quota recovery and community reset events remain separate. Cards are never used automatically.
- Local seven-day quota history with an independent 24-hour / seven-day trend window, hover values, explicit gaps, and confirmed manual / periodic reset markers
- Follow Codex startup on Windows: the packaged app enables a hidden per-user watcher on first launch; it checks for a Codex desktop window every five seconds and starts the companion on the next opening. Toggle it in either context menu. Closing the companion manually does not immediately reopen it during the same Codex session.
- The startup watcher checks the Codex installation path (including Store builds whose executable is named ChatGPT.exe), not Codex CLI processes. The portable version remembers its outer executable path; keep that file in a stable location or run it once again after moving it. Disabling the setting removes the startup shortcut and ends the watcher within five seconds.
- Yellow low-quota indicators and one silent desktop notification at each 20% / 10% threshold, independently for five-hour and weekly quota
- Green recovery checkmark for one minute after a confirmed exhausted-to-available transition; manual card resets do not send a duplicate recovery notification
- Orange clock indicators and a grouped notification for available reset cards expiring within 24 hours; click to select a card, with the existing confirmation before use
- Local notification history prevents repeated alerts after refresh or restart; the orb and tray menus provide a persistent desktop-notification toggle
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

The alert test uses a real Electron window with offline quota data and simulated desktop notifications. It checks badge colors, native hit regions, notification click actions, and the notification toggle, and saves actual UI previews in `release/alerts-preview/`. Windows controls the appearance and delivery of native desktop notifications.

The trend test uses generated offline history to check both time ranges, gaps, recovery events, hover values, and the empty state. Real history starts with the first successful refresh; it cannot reconstruct earlier usage or estimate token counts / billing. Startup detection can be checked without registering anything using `powershell.exe -NoProfile -File dist/follow-codex.ps1 -Probe`.

Build the portable Windows executable:

```powershell
pnpm build
```

The portable executable and installer are generated in `release/` with the current version in their filenames.
