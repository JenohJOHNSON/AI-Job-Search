# Implementation plan

Status (18 October 2026): the application is implemented and verified locally; no live deployment exists. See [AUDIT.md](AUDIT.md) for what was found and changed, and [DEPLOYMENT.md](DEPLOYMENT.md) for the remaining external steps.

1. Research references and licenses; classify permitted provider access. Done (REFERENCES.md, PROVIDER_MATRIX.md).
2. Strict TypeScript Next.js App Router, PostgreSQL/Prisma migrations, owner bootstrap and hashed sessions. Done.
3. Reviewed candidate data and immutable resumes, search profiles, provider settings, manual and URL import, accessible responsive light/dark workspace, application history. Done.
4. Provider-independent job contract; Greenhouse, Lever, Ashby, France Travail and allow-listed company-page adapters with bounded requests, retries, SSRF controls and complete-listing coverage. Done; Greenhouse/Lever/Ashby verified live, France Travail awaits credentials.
5. De-duplication across sources, freshness and removal detection, rule-based ranking before any AI. Done.
6. Schema-validated OpenAI/Anthropic/Gemini/OpenRouter evaluation with grounding, caching and atomic daily budgets. Done (stubbed-network tests; not run live).
7. PostgreSQL task queue and independent worker with leases, retry/backoff, crash recovery, built-in daily schedule and maintenance. Done.
8. Per-job notification de-duplication, email and Telegram, run diagnostics and usage reporting. Done (stubbed-network tests).
9. Docker web/worker targets, Railway configs, GitHub CI (including image boot check), environment examples, security and operations docs. Done; Railway itself needs your account.
10. Unit, PostgreSQL integration, browser end-to-end, accessibility and mobile tests; lint, typecheck, production build; bounded live public-provider smoke test. Done.

## Scope decisions

PostgreSQL is the only mandatory state service; no Redis, browser farm or paid scraper. HTML adapters fetch only explicitly allowed public domains and honour robots rules; access-denied responses never activate circumvention. No embeddings: synonym and skill-family tables cover the FR/EN vocabulary of the target roles. Optional pgvector, company enrichment and additional extraction services are extensions, not hidden placeholders. The interface and APIs use real stored records only.
