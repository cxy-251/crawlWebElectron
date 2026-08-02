# Plan 0016: Boss Background Job-Card Filtering

## Status

- Accepted: 2026-08-02
- Implementation: complete and authenticated live verification passed
- Supplements: `0015-boss-relevance-and-bounded-safari-pages.md`

## Evidence

The live `test` verification for Plan 0015 confirmed ten communications, but it
still opened 52 visible detail pages. Forty-seven of the rejected details were
inactive HRs. The configured keyword/JD rules therefore work, but they run too
late: Safari repeatedly navigates the detail tab before the workflow can read
the JD and HR activity.

Boss search results already expose `securityId`, `lid`, and `encryptJobId` in
the page's own job-list state. The authenticated same-origin read-only
`/wapi/zpgeek/job/card.json` response exposes the JD, HR activity, HR title,
and communication eligibility needed by the matcher.

## Goal

Use the search page's authenticated state to evaluate JD and HR relevance in
the background. Open the reusable visible detail tab only for candidates that
pass this evaluation, then perform the existing exact `立即沟通` click and
postcondition check. Keep `test=10`, `production=110`, and the shared daily
limit of 110.

## Decisions

1. **Site-adapter ownership**
   - `BossPageAdapter` extracts `securityId`, `lid`, and `encryptJobId` from
     the search page's own Vue job list when available.
   - The adapter may perform only the authenticated same-origin GET request to
     `/wapi/zpgeek/job/card.json`.
   - The workflow does not construct provider HTTP requests and never receives
     cookies or authentication material.

2. **Read-only asynchronous bridge**
   - Safari JavaScript starts an asynchronous same-origin XHR and stores only the sanitized result
     in a short-lived page-local request slot.
   - Python waits for a completed/error state, reads the result, and deletes the
     slot in every outcome so repeated reads do not retain response objects.
   - Missing identifiers, unavailable page state, non-success provider codes,
     and timeouts fall back to one visible detail read instead of aborting the
     complete run.

3. **Three-stage candidate path**
   - Search-card matching rejects structured-field failures and obvious
     non-development titles. A direction-title match is a hint, not a hard
     requirement before the JD is available.
   - Background job-card matching applies JD direction, HR activity, HR title,
     salary, experience, education, and company-size rules.
   - Missing HR activity is rejected now that the structured job-card response
     replaces the unreliable visible-DOM extraction as the primary source.
   - Only a background match, or an explicit background-read fallback, opens
     the visible detail tab. The visible page is re-read and revalidated before
     the communication state is inspected.
   - Today's keyword direction is exhausted first. Only a remaining shortfall
     enables the other configured keyword directions, preserving the 10/110
     target without weakening the JD, HR, or 0–3-year gates.

4. **Write boundary**
   - No friend/add, chat, greeting, resume, follow-up, or message API is used.
   - The only intentional Boss write remains the exact visible `立即沟通`
     control, with same-job and post-click confirmation.

5. **Memory and observability**
   - Search and detail pages remain independently owned and always close.
   - Page-local background results are removed immediately after consumption.
   - The page pair recycles after 12 search reads, 30 visible detail reads, or
     30 confirmed communications. Search-read age is monotonic within a page
     generation and no longer resets on every keyword navigation.
   - Result metrics distinguish background reads, background rejections,
     fallbacks, visible detail opens, rejection-reason distributions, page
     generations, and search reads.

## Verification

- Unit tests must cover Vue job-list extraction contracts, sanitized job-card
  mapping, request-slot cleanup, background rejection without visible detail
  navigation, fallback behavior, and final visible-page revalidation.
- The complete Safari RPA suite must pass through the repository uv workspace.
- An explicit `test` run may perform at most ten new communications. Its result
  must materially reduce visible detail opens from the 52-open Plan 0015
  baseline, report the open-to-confirm ratio, and identify every fallback open.
- Production must not be run manually during verification.

## Verification record

- The public `Leon9916/Boss-helper` implementation confirms the live contract:
  `#wrap .page-job-wrapper.__vue__.jobList` exposes `securityId`, `lid`, and
  `encryptJobId`; the GET response exposes `postDescription`,
  `activeTimeDesc`, `bossTitle`, `online`, `friendStatus`, and
  `canAddFriend`.
- Authenticated read-only live validation passed: the search list exposed
  `securityId/lid`, XHR returned the sanitized JD and HR fields, and the
  page-local request slot was removed.
- The first authenticated diagnostic `test` run
  (`d1a75f9d1d0e47babd4a71c3255f9f42`) scanned 447 keyword/job combinations,
  opened six details, and confirmed all six communications, but missed four of
  the target. Its events showed 223 candidates were rejected solely because
  the direction phrase was absent from the title, proving that the pre-JD title
  gate was still too early.
- The final authenticated `test` run
  (`89a19e52b732413dae618dce9b49454d`) reached 10/10 with no shortfall:
  132 combinations scanned, 32 unique background job-card reads, 10 visible
  details, 10 confirmed `立即沟通` writes, zero background fallbacks, and zero
  visible-detail rejections. The current-day keyword pool alone reached the
  target, so cross-direction overflow was not used.
- The final run recycled the page pair once at 12 search reads
  (`page_generations=2`, `page_recycles=1`). WebContent count moved from 5
  while idle to 9 at initial load, then 8 after recycling and 6 after workflow
  cleanup; total Safari memory was about 3.26 GiB idle, 6.36 GiB at the first
  loaded sample, 5.69–6.08 GiB during bounded execution, and 4.85 GiB
  immediately after cleanup. Safari pages remain expensive, but page/process
  growth is no longer unbounded within a run.
- The daily CSV parses to 16 confirmed/performed records: six from the
  diagnostic run and ten from the final run.
- The complete repository suite passes through the uv workspace: 114 tests,
  including four explicit opt-in integration skips.

## Non-goals

- Do not bypass login, CAPTCHA, risk-control, or Boss quota UI.
- Do not reduce the production target below 110.
- Do not scrape replies, chats, interviews, or recruiter messages.
- Do not keep raw provider responses, cookies, request headers, or credentials
  in workflow events or artifacts.
