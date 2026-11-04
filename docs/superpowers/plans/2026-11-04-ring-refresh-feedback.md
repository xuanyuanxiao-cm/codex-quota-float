# Ring Refresh Feedback Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this single renderer change, with independent tests and final review.

**Goal:** Make quota refreshing visible on the collapsed orb, matching the approved preview.
**Architecture:** Toggle loading and success classes from the existing renderer state; render a masked CSS pseudo-element inside the orb boundary. Use one cancellable 1000 ms timer for success feedback.
**Tech Stack:** Existing Electron, JavaScript, CSS, Node tests.
**Spec:** ../specs/2026-11-04-ring-refresh-feedback-design.md

## Global Constraints

No new dependencies, changed refresh requests, quota percentages, badge positions or native window dimensions. Keep gray old quota during reconnection. Respect reduced motion.

## Review Focus

Repeated renderer ticks must not replay success; new loading cancels success; failed refresh never flashes success; weekly-only layout and native hit regions remain stable; reconnect stays gray.

## Task 1: Renderer feedback

**Files:** `dist/renderer/renderer.js`, `dist/renderer/styles.css`, `test/renderer-smoke.test.js`, `test/electron-layout.cjs`, `README.md`.
**Interfaces:** Existing `state.status`; root `is-refreshing` / `is-refresh-success` classes; orb `aria-busy`.

- [x] Add state-transition tests and run `node --test test/renderer-smoke.test.js`; verify they fail because feedback is absent.
- [x] Add the minimal renderer class lifecycle and timer cleanup; CSS outer arc, one success flash and reduced-motion fallback.
- [x] Verify real Electron animation, failure/reconnect, weekly-only layout and unchanged native regions; keep existing double-click assertions.
- [x] Run `npm test` and `npm run test:window`; document the visible feedback in README.
- [x] Independently review the diff, then update the currently used local app if packaging inspection shows a safe reversible path.

## Execution Notes

User approved implementation of the preview, then requested installation, pushing all updates to the repository, and cleanup. Implemented in the clean existing checkout on feature branch `feat/ring-refresh-feedback`; no worktree or dependency setup was needed. Release as version 0.2.4 and fast-forward the existing main branch after verification.

## Verification and Delivery

- RED: original smoke test passed; five new transition tests failed on absent feedback. Real Electron check failed on absent aria-busy.
- GREEN: `npm test` passed 237/237; `npm run test:window` and `npm run test:alerts` passed. Real Electron checks include actual CSS rotation, rapid consecutive successes, reduced motion, unchanged bounds, double-click and weekly-only accounts. No reset cards consumed.
- Hidden test windows can delay animation frames beyond the one-second flash; inspect success immediately after delivery and test expiration separately.
- Independent review found no actionable production issue. A CSS-only animation concern was withdrawn after the actual-renderer rapid-refresh regression passed; no unnecessary forced layout was added.
- Initially applied only the two renderer files after verifying the archive entry sets. Kept the original archive and installer as local rollback backups.
- Built the version 0.2.4 Windows installer and portable executable. Silent installation exited successfully; installed binary, registry and archive versions match 0.2.4, and both renderer files match the source tree.
- Verified all seven existing user-data JSON files were preserved byte-for-byte across installation. Restarted the installed executable with its existing `--follow-codex` argument; main process and renderer started successfully.
- Build products, preview checks, test profiles and local deployment records remain outside version control. Preserve the current installers, rollback backups and the inline preview source when removing temporary files.
