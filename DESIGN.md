# TREK interface context

TREK is a collaborative travel planner with desktop and mobile shells. Upgrades retain the fork's debranded presentation, Traditional Chinese and zh-HK behavior, financial controls and source/legal access.

The maintained [appearance contract](client/src/theme/README.md) owns visual tokens and theme behavior. `client/src/index.css` defines tokens; `applyAppearance` and `theme-boot.js` apply user preferences. Mobile geometry uses the existing `m-*` tokens and shared sheet chrome. Preserve this identity when integrating upstream layouts.

Reuse `CurrencySelect` for common-currency semantics, `CustomDatePicker` for localized dates, `Modal`/`MSheet` for editing and `ConfirmDialog`/`MConfirmSheet` for destructive confirmation. Use existing toast and translation providers. Do not duplicate a screen's equivalent primitive.

The upgrade workflow contract is [v4.3.3 integration decisions](docs/agents/upgrades/v4.3.3.md): opening Costs is read-only, missing rates are explicitly reported, rate writes use preview then apply, and payment deletion is confirmed. Keep one payment ledger, original-currency editing and parity between desktop/mobile calculations. Shared selectors/hooks own currency conversion and form rate state.

Validate narrow mobile and desktop layouts, keyboard-accessible controls, localized labels, loading/error states, and All Days versus timeline recovery. Record actual browser evidence in the upgrade ledger; code inspection alone is not rendered verification.
