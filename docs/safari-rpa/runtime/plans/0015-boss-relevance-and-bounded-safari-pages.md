# Plan 0015: Boss Relevance Filtering and Bounded Safari Pages

## Status

- Accepted: 2026-08-01
- Implementation: implemented and verified
- Supplements: `0014-boss-code-first-career-directions.md`

## Evidence

The confirmed daily reports and runtime event ledger show that the workflow is
meeting its click quota more reliably than it is selecting relevant jobs:

- The search keyword is only used to build the Boss search URL. The final
  matcher receives neither that keyword nor a direction rule, and the extracted
  JD is written to CSV without participating in the decision.
- Most current rejections are title failures that could be decided from the
  search card before opening a detail page.
- The search and detail navigation share one `PageRef`. After a detail
  navigation, the next infinite-scroll action is not guaranteed to operate on
  the search result page.
- Search pages accumulate an unbounded infinite-scroll DOM and are reused across
  failed and successful runs. The workflow never closes its Boss pages.
- Rejection keys are date-scoped, so the same static mismatch is reopened every
  day.

## Goals

- Keep real writes limited to the Boss `立即沟通` control.
- Keep only `test` and `production` profiles with run limits of 10 and 110.
- Keep the shared daily limit at 110 and retain target replenishment.
- Restrict requested experience to zero through three years.
- Reject obvious card-level mismatches before opening a detail page.
- Require keyword/direction relevance in the JD before communication.
- Bound Safari page lifetime and infinite-scroll DOM growth without reducing the
  communication target.

## Decisions

1. **Keyword rules are executable configuration**
   - Every configured production search keyword maps to a direction rule in
     YAML.
   - Every keyword also carries one or more Boss `position` category codes.
     Configuration loading fails when a keyword omits this server-side filter.
   - A keyword rule supplies title signals and JD core signals; its direction
     supplies supporting and denied signals.
   - The workflow rejects production configuration when any search keyword lacks
     a rule, preventing future keywords from silently becoming URL-only filters.

2. **Two-stage matching**
   - Search cards extract job ID, title, salary, experience, education, company,
     location, and visible company scale.
   - Card matching applies hard title denials, software-title eligibility,
     experience, education, company-size, and salary rules. Unknown card fields
     may continue to detail when configured.
   - Detail matching reapplies the common rules, then requires JD core relevance
     to the active keyword and a minimum deterministic relevance score.
   - Exact search phrases are not required; YAML synonyms represent the intended
     career direction.

3. **Separate search and detail pages**
   - Add `create_page(parent, start_url)` to `SafariAutomationPort`.
   - Boss owns one search page and one reusable detail page inside the same Safari
     RPA workspace.
   - Infinite scrolling only operates on the search page. Detail navigation and
     communication only operate on the detail page.
   - Both pages close in workflow cleanup, including failure paths.

4. **Bounded batches**
   - Production keeps a run target of 110, executed in batches of 30 confirmed
     communications, with the final batch naturally containing 20.
   - A page pair is also recycled after a configured number of detail reads or
     scroll rounds, so a low match rate cannot grow Safari memory without bound.
   - Recycling recreates the search/detail pair and replays the current search
     scroll depth; the run-level `seen` set prevents duplicate detail reads.

5. **Rejection persistence**
   - Rejection records include a matcher fingerprint and retry date.
   - Static title, education, experience, size, salary, and JD relevance
     rejections remain reusable for 30 days while the fingerprint is unchanged.
   - HR inactivity is retried after seven days; unavailable or unknown page state
     remains retryable on a later run.
   - Confirmed communications remain permanently idempotent by job ID.

6. **Write and reporting behavior**
   - `collection` is removed. Communication is required for both remaining
     profiles.
   - The workflow does not send a greeting, resume, follow-up, or message and
     does not navigate to chat. The only intentional website write is clicking
     `立即沟通`; post-click state is observed before recording confirmation.
   - Daily CSV materialization happens at batch checkpoints and workflow exit
     instead of after every confirmed click.

## Verification

- Targeted unit tests passed: 60 tests covering keyword and `position`
  validation, card rejection without detail navigation, JD relevance, profile
  limits, rejection expiry, child-page ownership, page recycling, and cleanup.
- The complete Safari RPA suite passed through the repository uv workspace:
  100 tests, including four explicit opt-in integration skips.
- A read-only Safari integration test passed with the exact iOS `position`
  category. A separate live A/B sample for `HarmonyOS开发` returned 90 cards
  with one strict title match using text search, versus two cards with two
  strict matches using `position=100213`.
- Explicit `test` run `6ce1fac3843446078d636ddeaac74885` succeeded with ten
  confirmed communications and no shortfall. Across multiple city/keyword
  searches it cumulatively performed 225 job-keyword card evaluations, opened
  52 detail pages, rejected 163 cards before detail, and rejected 52 details.
  The prior
  text-search run needed 170 detail evaluations for five confirmations; the
  verified run needed 52 for ten.
- The final search surface contained 21 cards, 1,696 DOM nodes, and a 3,794 px
  scroll height. Workflow cleanup closed both owned Boss tabs and left only the
  empty Safari RPA workspace marker; user tabs were unchanged.
- No production run was started during verification.

## Non-goals

- Do not send messages, greetings, resumes, or follow-ups.
- Do not add reply or interview scraping.
- Do not bypass Boss login, risk-control, or experience-mismatch UI.
- Do not reduce the production run or daily target below 110.
