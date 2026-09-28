# Reset notices revision — approved 2026-09-28

The conversation is the approved specification. Implement inline; no desktop notifications and no independent probability model. Single-line orb label (variant 1); unread count includes related verified posts and observed account card arrivals, excludes unrelated chatter and probability changes. Opening never acknowledges. Preserve all history; default recent view is not deletion.

## Tasks
- [x] 1. Classification, evidence and persistent archive/migration. Verify the Sep 27 regression, negatives, expiry policy, >200 records, acknowledgement races and edits.
- [x] 2. Single-line status and real unread count, list paging/filter, explanations and selected details. Verify in Electron including click targets.
- [x] 3. Persistent per-account card observations and forecast journal. Verify missing data/switch/restart, gap-aware outcome evaluation.
- [x] 4. Backfill available last-three-month evidence with explicit source/coverage limits; no retrospective predictions or bulk notifications.
- [x] 5. Full tests, Electron UI, review, build and integrate.

## Rulings and progress
- Baseline: 148/148 unit tests pass at dce7bce. Native worktree unavailable for nested repository; isolated Git worktree used.
- User-data backup: ../backups/reset-notices-20260928/codex-reset-notices.json. Do not directly change a running app's state.
- Unknown timing remains unknown. Relative phrases such as next week may extend display conservatively but are not exact deadlines; overdue requires an explicit reliable deadline.
- Preserve upstream community summaries separately from verified original content. A changing summary must not erase a verified post or acknowledge an unread item.
- Forecast validation uses original archived probabilities; source gaps remain unscorable. Targeted replacement cards are excluded from broad outcomes. Unknown scope cannot prove an outcome.
- Firecrawl integration already exists; keep existing REST configuration and original-only extraction. Do not treat unavailable reply context as evidence.

- Verification: 170/170 unit tests pass; notices, alerts, layout, trends, regressions Electron suites pass. Notice UI rechecked after storage-error recovery and manual-read explanation fixes.
- Real-data rehearsal: 20 existing records + 14 nonduplicate imported records = 34; Sep 27 yields one unread, single-line label is 重置预告; state stable on restart. No live data was edited during rehearsal.
- Storage review: corrupt input is preserved; failed acknowledgements roll back in memory; successful subsequent writes clear only the storage error. Historical gaps deliberately remain unscorable.

- Delivery: installer and portable 0.1.15 built. Installed app.asar byte-for-byte matches tested build; 30 shipped dist files match source. Installer exited 0; running app upgraded actual archive to version 3 (34 messages, 1 unread).
- Backups: installed 0.1.14 app.asar and immediately pre-install notices saved outside the repo; migration also created .pre-v3.bak. Forecast journal starts at the next successful poll, never fabricates historical snapshots.
