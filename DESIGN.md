# TREK interface context

TREK is a collaborative travel planner with desktop and mobile shells. Upgrades retain the fork's debranded presentation, Traditional Chinese and zh-HK behavior, financial controls and source/legal access.

The maintained [appearance contract](client/src/theme/README.md) owns visual tokens and theme behavior. `client/src/index.css` defines tokens; `applyAppearance` and `theme-boot.js` apply user preferences. Mobile geometry uses the existing `m-*` tokens and shared sheet chrome. Preserve this identity when integrating upstream layouts.

Reuse `CurrencySelect` for common-currency semantics, `CustomDatePicker` for localized dates, `DialogShell`/`MSheet` for editing and `ConfirmDialog`/`MConfirmSheet` for destructive confirmation. Use existing toast and translation providers. Do not duplicate a screen's equivalent primitive.

The upgrade workflow contract is [v4.3.3 integration decisions](docs/agents/upgrades/v4.3.3.md): opening Costs is read-only, missing rates are explicitly reported, rate writes use preview then apply, and payment deletion is confirmed. Keep one payment ledger, original-currency editing and parity between desktop/mobile calculations. Shared selectors/hooks own currency conversion and form rate state.

Validate narrow mobile and desktop layouts, keyboard-accessible controls, localized labels, loading/error states, and All Days versus timeline recovery. Record actual browser evidence in the upgrade ledger; code inspection alone is not rendered verification.

The Plan page starts from upstream v5.1.0, commit dc36c21c08f681fd2806764fad8e17b270f6f175. Option A adds a calculated range and stay chip inside the existing place subline. The calculated range is plain clock text; separate fixed-start and fixed-end labels identify saved constraints. The original desktop menu Edit and mobile pencil still open the upstream place editor. The stay chip opens RoadtripStayModal or MRtStaySheet and writes only the selected visit's duration. Fixed End makes duration read-only. The automatic-timing switch is always visible and saves immediately. A separate day-start button opens an inline time field with Save/Cancel. Switch and stay targets are at least 44px high on touch devices. Route connectors show one duration, using the saved manual estimate when present; missing routes retain an explicit unknown/manual estimate control. Scheduling remains in the shared itinerary model, separate from saved inputs.

Keep the normal timeline compact. Timing help appears only in the expanded day-start editor; fixed-End guidance uses the existing End field hint. Missing travel is named in the existing connector, and a visit shows at most one conflict warning. Timing controls wrap within their available width on narrow phones; no new summary or waiting rows. Mobile Travel hides day timing controls while Plan retains them.
