# 0011 — Site workspace windows and Boss risk signals

## Status

- Accepted: 2026-06-29
- Implementation: implemented and verified
- Supplements: 0010

## Reason

Live Boss validation showed two runtime issues:

- Safari RPA can reuse a normal user Safari window when a matching site tab exists, so an RPA run can interfere with unrelated manual browsing.
- Boss can return `BOSS_RISK_CONTROL` while the page is still a usable `search_detail` page with both list and detail content. The current adapter treats any matching risk phrase in whole-page text as blocking, which is too broad for live pages with hidden or unrelated safety text.

The current AppleScript bridge also makes each DOM read a Python-to-AppleScript round trip. This plan does not replace that bridge, but it keeps the window ownership contract explicit so a later Safari extension bridge can reduce high-frequency DOM polling without changing workflow behavior.

## Decisions

- `SafariDriver.ensure_site(...)` owns site workspace selection.
- Each target origin uses a dedicated Safari RPA workspace window identified by a marker tab.
- Boss and Twitter continue to call the same `ensure_site(...)` contract; workflow code does not know about windows.
- If a site workspace window exists, the driver reuses a target-origin tab inside that workspace only.
- If no site workspace window exists, the driver creates a new Safari window with a marker tab, then opens the target site in a separate tab.
- The driver must not reuse arbitrary user Safari windows merely because they contain a matching site URL.
- Boss risk detection only blocks on visible blocking UI, full-page unavailable risk states, or explicit 403 URL/title signals. Hidden or incidental safety text on an otherwise usable search/detail page is diagnostic, not blocking.

## Non-goals

- Do not add or wire the Safari Web Extension bridge in this step.
- Do not perform live Boss communication or Twitter collection during verification.
- Do not change Boss quotas, filtering, side-effect ledgers, or schedule behavior.

## Implementation checklist

- [x] Update the plan index.
- [x] Add site workspace window selection to the Safari adapter.
- [x] Keep marker-tab support in the Python Safari adapter; no AppleScript bridge behavior change was needed.
- [x] Tighten Boss risk-control detection and diagnostics.
- [x] Add unit tests for workspace isolation and Boss risk false positives.
- [x] Run Conda `kwai` verification.

## Verification record

- `PYTHONPATH=src/safari-rpa conda run -n kwai python -m unittest tests.safari_rpa.unit.test_safari_driver -v` — passed.
- `PYTHONPATH=src/safari-rpa conda run -n kwai python -m unittest tests.safari_rpa.unit.test_site_adapters -v` — passed.
- `PYTHONPATH=src/safari-rpa conda run -n kwai python -m unittest discover -s tests/safari_rpa -v` — passed, 85 tests with 4 explicit opt-in integrations skipped.
