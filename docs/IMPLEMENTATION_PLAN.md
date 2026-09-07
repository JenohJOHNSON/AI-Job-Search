# Implementation plan

Status: implementation starting; no live deployment yet.

1. Research references and licenses; classify permitted provider access. Record decisions in REFERENCES.md and PROVIDER_MATRIX.md before adapter implementation. No third-party source code will be copied.
2. Scaffold strict TypeScript Next.js App Router, PostgreSQL/Prisma migrations, secure personal account bootstrap and revocable hashed sessions. Keep database access in services.
3. Implement reviewed candidate data and immutable uploaded resumes, multiple validated search profiles, provider settings, real empty states, manual job import, accessible responsive light/dark dashboard and application history.
4. Implement provider-independent normalized job contract. Build Greenhouse, Lever, Ashby, France Travail and permission-configured company JSON-LD adapters with bounded requests, SSRF controls, offline fixtures and independent health. Other boards remain explicitly unavailable until permitted access is configured.
5. Add URL/source, identity and description deduplication; retain source provenance and prefer ATS application URLs. Add bounded persisted queries and deterministic filtering before AI.
6. Add schema-validated OpenAI/Anthropic/Gemini/OpenRouter evaluation, grounding rules, timeout/retry, fingerprint caching, hard requirement checks and atomic daily spend reservations. Profile extraction and application documents use the same budget.
7. Add a PostgreSQL durable task queue and independent worker: leased tasks, fencing tokens, retry/backoff, recovery after crashes and a database constraint preventing overlapping searches. Manual and authenticated scheduled endpoints return immediately.
8. Implement a single deduplicated daily email digest and optional Telegram, search/run health and usage reporting. Never send notifications until explicitly configured.
9. Provide Docker web/worker targets, Railway configs, GitHub CI and cron, environment examples, security/privacy and operations instructions.
10. Run offline unit/parser/security tests, PostgreSQL integration tests, lint, typecheck, production build, browser checks and a bounded live public-provider smoke test. Record actual results and limitations. Commit logical milestones when possible.

## Scope decisions

PostgreSQL is the only mandatory state service; no Redis, browser farm or paid scraper is required. HTML adapters fetch only explicitly allowed public domains and honor robots rules; access-denied responses never activate circumvention. The first release does not implement speculative board selectors or embeddings. Optional pgvector, company enrichment and additional extraction services are extensions, not hidden production placeholders. UI and APIs use real stored records only. Repository publication and Railway deployment require the destination account/project and runtime secrets; prepare and test all deployable artifacts first.
