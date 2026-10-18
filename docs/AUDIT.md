# Technical audit

Audit of the repository as received (commit `1379024`) against its own README and the project goals. Method: read every source file; install, migrate, lint, typecheck, test and build; run the web app and worker against PostgreSQL; drive the real HTTP API with live public job boards; later, drive the UI in Chromium. "Verified" means observed running, not inferred.

## Baseline

`npm run lint`, `typecheck`, `test` (13 tests) and `build` all passed; the Prisma migration matched `schema.prisma`; the core pipeline (setup, login, provider configuration, queued run, worker, persistence, de-duplication) worked end to end against Greenhouse, Lever and Ashby. The architecture (leased task queue, hashed sessions, SSRF controls) was sound. The problems were in result quality, missing documented features and robustness.

## Findings

Severity: **High** breaks the core goal or loses data · **Medium** wrong or missing documented behaviour · **Low** polish or hardening.

| # | Sev | Finding | How verified | Resolution |
| --- | --- | --- | --- | --- |
| 1 | High | Without an AI key no job had a score; dashboard, filters and notifications were empty, so the main workflow was dead without AI. | Code reading; live run showed `matchScore = null` everywhere. | Transparent rule-based engine ([MATCHING.md](MATCHING.md)); AI refines only. |
| 2 | High | Board adapters filtered by substring and a 3-day publication window, discarding almost every open position and requiring the location string to appear in the text (dropping remote-Europe roles). Live: 149 vacancies on one board, 10 kept, internships ranked 2nd–6th. | Live run + database query. | Adapters return full boards; the matching engine decides relevance; the window now applies only to search-based sources. |
| 3 | High | Digest looked back 36 hours with no per-job record, so the same job was re-announced on consecutive days; no digest at all without AI scores. | Code reading. | `JobNotification` reservation per job and channel, at-most-once with release on failure. |
| 4 | High | `npm run worker` per the README crashed: `tsx` does not load `.env`. | Reproduced. | Worker loads `.env`. |
| 5 | High | Worker process died on any database error (`claimTask` outside a try/catch). | Reproduced when the database was unmigrated. | Loop catches, backs off and keeps polling. |
| 6 | High | Queue SQL compared UTC-stored timestamps with `NOW()` (session time zone), so leases and scheduled tasks were wrong on any non-UTC database. | Integration test failed on a Paris-time PostgreSQL. | Explicit `AT TIME ZONE 'UTC'`. |
| 7 | High | Profile page replaced the form every 10 seconds (polling) and “Review in profile form” spread the whole AI result over the profile, blanking existing preferences. | Code reading. | Load once per saved version; per-field review of suggestions; nothing applied without selection. |
| 8 | High | `pdf-parse` 1.1.1 (bundled 2018 pdf.js) failed on ordinary PDFs (“bad XRef entry”); parsing also ran in-process although the docs claim a bounded subprocess. | Test with a pdfkit PDF. | `pdfjs-dist` 4.10 in a memory-capped, time-limited worker thread; DOCX via mammoth in the same thread. |
| 9 | Med | France Travail adapter: legacy token host, no geographic filter, no paging, empty 204 responses crashed `.json()`, salary and experience ignored, offers identified by a possibly shared partner URL. | Code reading against the API documentation. | Rewritten (départements, paging, 200/206/204, salary/experience parsing, stable identity URL). Not live-testable without credentials. |
| 10 | Med | Greenhouse content arrives HTML-escaped and was shown as `&lt;p&gt;`; Lever requirements (`lists`) were dropped; company name was the board slug. | Fixture and live data. | `cleanText`, Lever lists, real names. |
| 11 | Med | No bounded retry or `Retry-After` handling although documented. | Code reading. | Retries with backoff for timeouts, 429 and 5xx only. |
| 12 | Med | No detection of expired or removed vacancies; adapters' `healthCheck()` unreachable from the UI. | Code reading. | Board coverage reconciliation, `validThrough` expiry, France Travail look-ups, connectivity-check endpoint. |
| 13 | Med | Search-profile fields `keywords`, `salaryMin`, `contractTypes`, `seniority`, `minimumMatchScore` were saved but never used. | Grep. | Used by the engine and by storage filtering. |
| 14 | Med | “Save” reset an applied job to Saved; replaying a finished run's idempotency key returned 500; `/analyze` and `/documents` queued tasks that could only fail without AI; invalid filter values produced 500. | Code reading + smoke test. | Fixed with guards and clear 409/400 responses. |
| 15 | Med | `NEXTAUTH_SECRET` required but unused. | Grep. | Optional and documented as deprecated. |
| 16 | Med | A crash between creating a run and its task left a run that nothing would execute and blocked all new runs. | Code reading. | Run and task created in one transaction; maintenance fails abandoned runs. |
| 17 | Med | Missing: dismiss, URL import, notes/follow-up/interview UI, DOCX export, document versions, editable thresholds/schedule, daily schedule independent of GitHub, test notifications. | Feature review. | Implemented. |
| 18 | Med | Cross-source duplicates: an empty description produced identical fingerprints, merging unrelated postings; `(H/F)` and `METZ (57)` noise defeated matching. | Integration tests. | Safer rules plus title/location normalisation. |
| 19 | Low | Setup secret endpoint not rate limited; setup could race into two owners; login timing revealed unknown emails. | Code reading. | Rate limits, advisory lock, dummy-hash verification. |
| 20 | Low | Sidebar overflowed at 720 px height (sign-out unreachable), WCAG AA contrast failures, unnamed progress bars and buttons, login-form flicker, page-wide horizontal scroll on phones. | Playwright + axe-core. | Fixed; the suite now guards each. |
| 21 | Low | `tsconfig.tsbuildinfo` tracked in git. | `git ls-files`. | Untracked, ignored. |
| 22 | Low | Dependency advisories (`next`, `nodemailer`, `sharp`, `source-map-js`). | `npm audit`. | Upgraded; 3 moderate remain (see README). |

## Not changed, deliberately

- Single-owner model, session design and the PostgreSQL queue were kept.
- No scraping of restricted platforms; no proxy, CAPTCHA or stealth tooling.
- No embeddings; no Redis; no paid extraction service.

## Not verifiable without your credentials

France Travail live calls, AI providers, Resend/SMTP and Telegram delivery, and Railway itself. Each is covered by stubbed-network tests of its request and response handling; none was exercised live.
