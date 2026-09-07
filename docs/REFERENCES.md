# Reference review

Reviewed on 2026-09-07 before implementation. This is a design review of the requested references, not a claim that their code or services have been deployed. No upstream application code was copied. Repository observations are pinned below; hosted-service documentation can change.

## Repository inventory and licenses

| Reference and inspected revision | License observed | Relevance |
| --- | --- | --- |
| [career-ops-hq/career-ops](https://github.com/career-ops-hq/career-ops/tree/8a20e491fdde2c928a54ff17a7bfe07ca5d2ab40) | [MIT; copyright 2026 Santiago Fernández de Valderrama](https://github.com/career-ops-hq/career-ops/blob/8a20e491fdde2c928a54ff17a7bfe07ca5d2ab40/LICENSE) | Candidate context, evaluation reports, document generation, resumable batches, application tracking. |
| [MadsLorentzen/ai-job-search](https://github.com/MadsLorentzen/ai-job-search/tree/1a116b3c6492347e040d0546135c9b4c70540fbb) | [MIT; copyright 2026 Mads Lorentzen](https://github.com/MadsLorentzen/ai-job-search/blob/1a116b3c6492347e040d0546135c9b4c70540fbb/LICENSE) | Explicit language requirements, provenance, tailored application workflows. |
| [kiryano/Scout](https://github.com/kiryano/Scout/tree/183868d4fe4b9800d649d814ad8685750cc5637d) | [MIT; copyright 2026 Scout](https://github.com/kiryano/Scout/blob/183868d4fe4b9800d649d814ad8685750cc5637d/LICENSE) | Social-profile lead generation; limited relevance to job discovery. |
| [d4vinci/Scrapling](https://github.com/D4Vinci/Scrapling/tree/28c329671485daaea89a40fb34a7db8622e51468) | [BSD-3-Clause; copyright 2024 Karim shoair](https://github.com/D4Vinci/Scrapling/blob/28c329671485daaea89a40fb34a7db8622e51468/LICENSE) | Fetch/parse separation, crawl scheduling, concurrency and persistence. |
| [arshka/LinkedIn-Job-Scraper](https://github.com/arshka/LinkedIn-Job-Scraper/tree/62c2e559234fe7b5cff3d902ccda9cea2d069c63) | No license file found in the inspected tree; GitHub's license endpoint returned 404. | Discovery/detail separation and job-data concepts only; no code reuse. |

Any future vendoring must separately preserve the applicable upstream notices. The inventory above records observed files; it does not grant rights for data collected from third-party platforms.

## Useful concepts and deliberate departures

**Career-ops.** Its [architecture](https://github.com/career-ops-hq/career-ops/blob/8a20e491fdde2c928a54ff17a7bfe07ca5d2ab40/ARCHITECTURE.md) separates software from candidate-owned files, treats editable files as canonical, and leaves application submission to the person. Adopt candidate-data isolation and a reviewable application workflow. For a concurrent web platform, use transactional relational storage as the canonical store instead of reproducing its Markdown tracker design.

Its [batch documentation](https://github.com/career-ops-hq/career-ops/blob/8a20e491fdde2c928a54ff17a7bfe07ca5d2ab40/batch/README.md) describes bounded workers, persisted item states, explicit failed-item retries, a paused state for usage limits, and reconciliation after merging worker outputs. Adopt durable per-item state and idempotent reconciliation. Its [tracker deduplicator](https://github.com/career-ops-hq/career-ops/blob/8a20e491fdde2c928a54ff17a7bfe07ca5d2ab40/dedup-tracker.mjs) preserves advanced application status when consolidating duplicates. Keep user decisions and status history separate from replaceable job observations.

**AI Job Search.** The [evaluation specification](https://github.com/MadsLorentzen/ai-job-search/blob/1a116b3c6492347e040d0546135c9b4c70540fbb/.claude/skills/job-application-assistant/04-job-evaluation.md) checks explicitly required working languages separately from scoring and distinguishes job requirements from the language of the advertisement. Adopt this distinction for French/English opportunities. Do not transplant its citizenship/security-clearance assumptions into France-specific eligibility logic. The [provenance tests](https://github.com/MadsLorentzen/ai-job-search/blob/1a116b3c6492347e040d0546135c9b4c70540fbb/tests/test_scrape_provenance.py) distinguish portal results from search-engine fallback and preserve unknown provenance on historical records. Persist acquisition mechanism, source URL, retrieval time and parser version; never label a search result as a verified live vacancy.

**Scout.** The [README](https://github.com/kiryano/Scout/blob/183868d4fe4b9800d649d814ad8685750cc5637d/README.md) describes profile scraping, email enrichment and CSV export, rather than CV-to-job matching. The [scraper registry](https://github.com/kiryano/Scout/blob/183868d4fe4b9800d649d814ad8685750cc5637d/app/scrapers/__init__.py) provides a useful example of per-platform modules behind one interface. Adopt that modular boundary only. Email guessing, SMTP verification, profile harvesting and account-cookie collection do not serve the requested job-search workflow.

**Scrapling.** Its [spider architecture](https://github.com/D4Vinci/Scrapling/blob/28c329671485daaea89a40fb34a7db8622e51468/docs/spiders/architecture.md) separates scheduler, engine, sessions and parsing callbacks. Request fingerprints support queue deduplication; global/per-domain limits control concurrency; checkpoints preserve pending requests and seen URLs. These are useful operational concepts, but request deduplication does not replace cross-board job deduplication. If used later, configure its robots option deliberately and validate extracted job fields after any adaptive selector recovery. Browser or blocked-response handling is not evidence of permission to access a source.

**LinkedIn Job Scraper.** The [README](https://github.com/arshka/LinkedIn-Job-Scraper/blob/62c2e559234fe7b5cff3d902ccda9cea2d069c63/README.md) separates discovery of identifiers/basic fields from detail enrichment. Its [database description](https://github.com/arshka/LinkedIn-Job-Scraper/blob/62c2e559234fe7b5cff3d902ccda9cea2d069c63/DatabaseStructure.md) distinguishes jobs, companies, salaries, skills, application URLs and posting timestamps. Adopt these general data-model concepts through original implementation. Its multiple-account approach and lack of an observed license make it unsuitable as a code dependency.

## Hosted acquisition services

| Service | Verified capability | Integration decision |
| --- | --- | --- |
| [Firecrawl](https://www.firecrawl.dev/) | [Batch scraping](https://docs.firecrawl.dev/features/batch-scrape) accepts a URL list, supports structured extraction, returns an asynchronous job ID, exposes status/results, and permits a concurrency cap. The documentation states API batch results expire 24 hours after completion. | Optional extraction transport behind the same provider contract. Persist returned observations promptly. Validate JSON, keep provenance, cap URLs and cost. Its server repository's [root license is AGPL v3](https://github.com/firecrawl/firecrawl/blob/main/LICENSE); hosted API terms and individual SDK licenses are separate concerns. |
| [ScraperAPI dashboard](https://dashboard.scraperapi.com/home) | The dashboard did not expose account data to this review. Official [batch documentation](https://docs.scraperapi.com/nodejs/making-requests-or-nodejs/async-requests-method-or-nodejs/async-batch-requests-or-nodejs) documents submitting URL arrays and receiving per-job status URLs. Its [status documentation](https://docs.scraperapi.com/nodejs/handling-and-processing-responses/api-status-codes) describes provider-side retry behavior. | Optional HTML transport with explicit key configuration. Respect provider concurrency and timeout behavior; avoid multiplying long provider retries with an unbounded application retry loop. No account quota or paid plan was verified. |
| [Apify Console](https://console.apify.com/) | The console did not expose account data. Official [run documentation](https://docs.apify.com/actors/running/runs-and-builds) describes Actor builds, run lifecycle, datasets, request queues and build pinning. Actor output may vary by build. | Require an explicitly configured Actor and validated input/output schema; pin a tested build. Store run ID and dataset provenance. Treat Actor-specific terms, cost and supported sources as configuration prerequisites, not universal platform guarantees. |

No hosted service was called with user credentials, and no provider integration is represented as connected by this review. A provider can retrieve content; it does not establish that every job board is supported or that a vacancy is current.

## Resulting implementation guidance

These are our design decisions, informed by the references rather than upstream claims:

1. Normalize each provider into one validated job record while retaining original source metadata.
2. Deduplicate first by provider identifier/canonical URL, then conservatively by company, role and location. Preserve multiple observations and application history.
3. Store scrape runs and per-source failures; a partially failed run must not look like an empty successful search.
4. Separate explicit eligibility constraints from the match score. Explain skill overlap and gaps using candidate evidence; never invent qualifications or salary facts.
5. Persist resumable work and apply bounded retries only to recoverable failures. Authentication and quota errors need clear operational status.
6. Make API keys optional, visibly distinguish demonstration data, and retain a complete local workflow when paid providers are unavailable.
