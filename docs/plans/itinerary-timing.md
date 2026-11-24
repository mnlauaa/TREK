# Shared arrival and stay scheduling

Approved 2026-10-06. Base: origin/dev (v4.3.3), branch codex/itinerary-arrival-stay.

## Behavior
Reuse Road trip timing helpers and duration controls in the desktop and mobile itinerary. No fixed times: arrival follows travel and departure adds stay. Start only: anchor Start and add stay. End only: arrive from travel and stay until End. Both fixed: the interval determines the read-only stay. Hide duration editing whenever End is fixed; preserve its saved value for when End is cleared.

Never overwrite fixed inputs with predictions. Late travel preserves the chosen times, warns, and carries reachable predictions forward: End 14:00 reached at 14:30 predicts departure 14:30. Early arrival waits for fixed Start. Stay includes onsite waiting, excludes travel.

New regular days enable timing at 09:00 (departure from a routed starting hotel, otherwise first arrival); existing days opt in. Regular itinerary retains assigned days and labels midnight carry. Road trip retains its driving windows and automatic overnight distribution.

## Data
Per-visit duration overrides the place default, then 60 minutes; zero is valid. Explicit time clearing must override legacy inheritance without modifying the place. Day preferences and manual leg minutes use shared validated contracts, permission-checked services, the existing offline queue/cache, and realtime updates. Manual leg minutes are keyed by endpoint pair and transport mode. Unknown routes remain unknown; timing works with map lines hidden.

Booking times remain owned by bookings. Show links and contextual warnings for timed restaurant/event/tour appointments, separately for each non-cancelled booking; ambiguous and date-only bookings are reference only. Transport, parking, rentals and hotels retain specialized handling. Never resize a visit to fit a booking.

Use named fork migrations, preserve upstream migration numbering, and carry inputs through copy/import/export. Shared/read-only and PDF views use available estimates without inventing missing times.

## Validation
Test all four time combinations, late fixed times, zero stay, clearing/restoring fixed times, repeated places, unknown routes, manual travel overrides after reorder/mode changes, offline replay, realtime changes, booking interval warnings, midnight ownership, migration reruns, and existing Road trip/hotel/transport behavior. Verify desktop/mobile accessibility, 12/24-hour formatting and locale parity. Run relevant tests, typechecks, lint, theme and build gates.

## Implementation verification — 2026-10-06

Implemented on `codex/itinerary-arrival-stay`, based on freshly fetched `origin/dev` at `32ee7a3` (v4.3.3). The migration is `fork/itinerary-timing-v1`; the upstream numeric migration chain is unchanged.

Passed: 912 shared tests; focused server integration/MCP/calendar/Road trip/copy/migration suites; client planner, duration editor, offline replay, collaborator update, public share and PDF suites; shared/server/client typechecks (including server test types); shared formatting; lint with no errors; all 23 locale parity checks; page-pattern, plugin-facts, theme and GL-split checks; shared/server/client builds. Existing lint warnings and bundle-size warnings remain.

An isolated Playwright database on ports 3006/5176 verified desktop and Pixel-sized mobile flows: duration editing and reload persistence, linked booking preservation, keyboard fixed-time editing, missed-End prediction, clearing End to restore the saved duration, and navigation to the booking page. Screenshots were visually checked. Unit coverage also verifies 12/24-hour formatting, unknown travel, manual hotel-leg estimates and same-place visit isolation. Browser runs sometimes could not fetch external map tiles/weather; scheduling checks still passed independently.

The generic premium UI audit reports 90 existing project-wide findings (including legacy forms and scrollbar ownership). None concern the new timing components; unrelated UI remediation is outside this feature.

## Release review — 2026-11-05

Reapplied the feature onto release v4.3.4 without changing the release workflow, Argo CD backup hooks, hardened workload or network policy. Review corrected the itinerary booking adapter: rental and parking intervals are handovers rather than rides, and reference-only/date-only bookings do not create timing nodes. Added regression coverage for these cases while retaining carrier timetable behavior.
