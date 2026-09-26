# Test coverage and migration

Run every unit test with `pnpm test`. Electron tests use offline fixtures and run separately with `test:window`, `test:alerts`, `test:trends`, `test:notices`, and `test:regressions`.

The eight compiled Vitest files formerly under `dist/` were not part of the default test command. Their applicable checks now use the existing Node test runner, without a second test framework:

| Former test file | Current coverage |
| --- | --- |
| `app-server-client.test.js` | `app-server-client.test.js` (discovery, initialization, RPC, parsing, subscriptions, stop); `app-server-recovery.test.js` (exit and reconnect); `reset-credit-protocol.test.js` (consumption and idempotency) |
| `refresh-controller.test.js` | `refresh-scheduling.test.js` (startup, periodic/manual refresh, retry timing, coalescing, stale/error state, sparse updates, stop); `reset-credit-selection.test.js` and `refresh-reset-race.test.js` (credit selection and post-reset reads) |
| `main.test.js` | `window-bootstrap.test.js`, `taskbar-pinning.test.js`, `startup-recovery.test.js`, `reset-confirmation.test.js`, `reset-credit-selection.test.js`, `collapsed-window.test.js`; real close/restore/quit checks in `electron-regressions.cjs` |
| `tray-menu.test.js` | `tray-menu.test.js` (current menu entries, callbacks and availability) |
| `usage-model.test.js` | `usage-model.test.js`, `five-hour-quota.test.js`, `account-plan.test.js` |
| `window-position.test.js` | `window-bootstrap.test.js`, `window-shape.test.js`, `collapsed-window.test.js` |
| `renderer/renderer.test.js` | `view-model.test.js`, `five-hour-quota.test.js`, `renderer-smoke.test.js`, `click-to-open.test.js`, `reset-credit-picker.test.js`, `reset-confirmation.test.js`; real HTML bootstrap, drag, sizing and hit-region checks in `electron-layout.cjs` |
| `renderer/click-arbiter.test.js` | `click-arbiter.test.js` (delay, cancellation, replacement and disposal) |

Obsolete expectations were updated to the current behavior: separate five-hour and weekly windows, a 76px orb, initially collapsed bounds, content-driven panel height, compact countdowns, current menu entries, and native confirmation before consuming a selected credit. Tests referring to missing TypeScript sources or removed renderer exports were replaced with checks of the current JavaScript and rendered UI.
