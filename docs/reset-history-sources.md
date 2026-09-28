# Historical source coverage — 2026-09-28

The bundled archive requests 2026-06-28 through 2026-09-28. It contains 16 candidate messages with direct Tibo post URLs, not a complete three-month timeline. Loading against the existing 20-message local archive adds 14 messages (34 total). The known September 27 teaser is repaired from the already authenticated local original, not from a new community assertion.

Sources:
- [Codex Reset Observatory history](https://github.com/gussuri/codex-reset-observatory/blob/main/data/resetHistory.ts)
- [Tibo Reset Lab announcement catalogue](https://github.com/CRF2004/tibo-reset-lab/blob/main/data/processed/reset_announcements.csv)
- [Tibo Reset Lab source index](https://github.com/CRF2004/tibo-reset-lab/blob/main/data/raw/sources.csv)

Only source-linked rows are included. The research catalogue's summarized `raw_text` field is treated as a community summary, never authenticated verbatim text. Observatory rows may carry an event timestamp rather than original publication time, explicitly marked `archive-event`. Rows without exact post URLs and periodic-account references are excluded. The research catalogue ends in July; neither source supplies a complete August timeline or all service replies. Community records remain unverified until the existing original-post verifier succeeds, and backfill stays read.

`scripts/backfill-reset-history.ps1` regenerates the snapshot without executing upstream code. It does not change user data. It is a one-time archive importer, not a new forecasting source, live poller or model.

The existing public current API still supplies only a small history slice and one latest activity. Consequently a quiet interval cannot be used as proof of no resets. Forecast windows without positive verified evidence become unscorable; no accuracy percentage is reported from this biased subset. Account-specific replacement cards never establish a broad outcome.

Known limitations: replies without accessible parent text cannot be resolved confidently; relative time phrases without timezone remain imprecise. Only an explicitly zoned ISO deadline is used for precise overdue state. “Next week” receives a conservative 14-day display lifetime, not an inferred promise deadline; other untimed promises use 48 hours. Completed/cancelled/pending states use 24 hours. These display policies never acknowledge a message.
