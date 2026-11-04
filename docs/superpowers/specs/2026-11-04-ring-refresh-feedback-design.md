# Ring refresh feedback

The user approved the interactive `ring-refresh-preview.html` preview on 2026-11-04.
The user subsequently selected the yellow variant of `ring-color-comparison.html` and authorized applying it.

- Reuse the renderer's existing loading/ready/stale/error state for all quota refresh sources.
- Show a bright-yellow (#FFE45C) rotating arc with a 2.5 px solid stroke, 0.5 px feather, and 75-degree opaque body within the existing 76 px orb boundary. Preserve both quota rings, percentage values, badge positions and click behavior.
- On loading → ready, flash the yellow outer outline once for about one second. Repeated ready broadcasts must not replay it. A new refresh cancels an earlier flash.
- On failure, stop the arc and keep the existing gray offline appearance. Reconnecting keeps old quota gray until success.
- Expose aria-busy and a loading status; respect reduced-motion preferences with a stationary loading indicator.

## Approaches

Approved: a separate outer arc; it preserves quota meaning and does not compete with existing corner badges. Rotating quota rings would move their meaningful fixed origin. Another badge would compete with four existing badge positions.

## Scope

Renderer styling and lifecycle only; no backend requests, scheduling, window geometry or extra dependencies. Verify state transitions, real rendered animation, weekly-only accounts, double-click behavior and failure/reconnection.
