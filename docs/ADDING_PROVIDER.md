# Adding a provider

Providers translate a permitted source into the canonical `NormalizedJob` contract. They never access PostgreSQL, candidate data, matching rules or notifications.

1. Confirm the source's current terms and robots policy. Prefer an official API, public feed or documented public endpoint. Add the evidence and limitations to `PROVIDER_MATRIX.md` before writing an adapter.
2. Implement `JobProvider` from `providers/types.ts`. `search` must return jobs plus extraction counts and warnings (and, when it reads a *complete* listing, `coverage`: one `{scope, sourceJobIds}` per board or page so vanished vacancies can be marked removed; set `scope` on each job). For employer boards use `crawlBoards` / `checkBoards` from `providers/board.ts`. Search-based sources may implement `verify(ids)` instead; `fetchDetails`, `normalize` and `healthCheck` must be independently testable. Raise `ProviderError` with a classified code.
3. Parse responses with explicit local types, then pass every result through `normalizedJobSchema`. Preserve provider identifiers, the original URL, extractor name and useful non-secret metadata. Missing salary stays `null`.
4. Bound result counts, response bytes, redirects and timeouts. Fixed official hosts may use `fixedFetch` (bounded retries with backoff, typed errors). Arbitrary company URLs must use `safePublicFetch`, an explicit host allowlist and robots permission. Never add CAPTCHA, credential-cookie, stealth or access-control bypass logic.
5. Register the adapter in `providers/index.ts` and initialize it disabled. Add offline fixtures for a successful result, malformed data, empty data and provider failure. Unit tests must not call the live network (stub `fetch`; see `tests/provider-behaviour.test.ts`). `search` should return the *whole* listing: relevance is decided by the matching engine, not by the adapter.
6. Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`. A provider regression must degrade only that provider.

```ts
export class MyProvider implements JobProvider {
  id = "my_provider";
  async search(request: SearchRequest): Promise<ProviderSearchResult> { /* bounded public API */ }
  async fetchDetails(url: string): Promise<NormalizedJob> { /* same validation */ }
  normalize(raw: unknown): NormalizedJob { return normalizedJobSchema.parse(/* mapping */); }
  async healthCheck(): Promise<ProviderHealth> { /* no private data */ }
}
```

When an integration becomes prohibited or unreliable, mark `supported: false` and explain it in the provider matrix. The rest of the pipeline continues.
