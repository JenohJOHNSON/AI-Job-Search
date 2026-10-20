# Multi-model AI scoring

With `OPENROUTER_API_KEY` set, Élan scores each promising job with up to three AI models through [OpenRouter](https://openrouter.ai). All three use the same rubric. The final match score is the mean of the models that returned a valid answer. The rule-based score ([MATCHING.md](MATCHING.md)) is still computed first, and decides which jobs are worth scoring.

## Models

Each slot is one independent evaluation, configured as a comma-separated list. The first model is the primary; the rest are fallbacks, tried in order. These model IDs were checked against OpenRouter's public model list (`GET https://openrouter.ai/api/v1/models`) on 2026-10-20.

| Slot | Primary | Fallbacks, in order | Variable |
| --- | --- | --- | --- |
| 1 | Claude Sonnet 5.5 `anthropic/claude-sonnet-5.5` | `anthropic/claude-sonnet-5`, `openai/gpt-6.1-sol` | `AI_SCORING_SLOT_1` |
| 2 | Claude Fable 5.1 `anthropic/claude-fable-5.1` | `anthropic/claude-fable-5`, `anthropic/claude-opus-5.5` | `AI_SCORING_SLOT_2` |
| 3 | GPT-6 Astra `openai/gpt-6-astra` | `openai/gpt-6-luna`, `openai/gpt-6-sol` | `AI_SCORING_SLOT_3` |

- **Preferring GPT-6 Luna.** Luna costs about 1% of Astra's price per token. To use it as slot 3's primary, set `AI_SCORING_SLOT_3=openai/gpt-6-luna,openai/gpt-6-astra`.
- **Disabling a slot.** An empty value disables that slot.
- **Malformed IDs.** Malformed IDs are ignored and listed under **Settings → AI matching**, which also shows the active configuration.
- **Reasoning effort.** `AI_SCORING_REASONING_EFFORT` (`low` by default; `minimal`, `medium`, `high`, or `default` for each model's own setting) controls how much the models reason. Reasoning tokens are billed as output.
- **Prices.** Prices are read live from OpenRouter, so no price variables are needed.

## How a job is scored

1. **Selection.** Jobs at or above **Settings → Only analyse jobs scoring at least** are scored, best rule-based score first, until the daily limits are reached. A job without a hard blocker and with a description qualifies. Job-alert emails carry no description, so they are skipped.
2. **Identical input.** Every model receives the same system instruction, rubric, candidate profile, search preferences (titles, work styles, locations, contracts and minimum salary from the enabled search profiles) and job facts. Job descriptions are cut at 24,000 characters. The job text is marked as untrusted data.
3. **Structured answer.** Each model returns JSON in a fixed schema, enforced with OpenRouter structured outputs and checked again by Élan:
   - an integer score from 0 to 100 and a reason for each of seven dimensions
   - mandatory and preferred qualifications, each marked `met`, `missing` or `unclear`
   - the matched skills
   - the information that was missing
   - a short summary and a recommendation

   An answer with a missing dimension, a score outside 0–100 or invalid JSON is rejected.
4. **No invented facts.** A matched skill that is not in the profile is dropped. A requirement marked `met` whose evidence cannot be found in the profile becomes `unclear`.
5. **Model score, computed by Élan.** Each model's score is a weighted sum of its dimension scores:

   | Dimension | Weight |
   | --- | --- |
   | Skills match | 22 |
   | Job requirements | 20 |
   | Relevant experience | 15 |
   | Overall suitability | 15 |
   | Seniority alignment | 10 |
   | Location compatibility | 10 |
   | Work-style compatibility | 8 |

   One missing mandatory qualification caps the model's score at 55, and each further one subtracts 7. The result is rounded to an integer.
6. **Final score.** The final score is the arithmetic mean of the valid model scores, to two decimals; for example (92 + 88 + 95) / 3 = 91.67. Élan computes it, never a model.
   - `Job.aiAverageScore` keeps the exact mean. `Job.matchScore` holds it rounded.
   - `Job.rankScore` is the rounded mean, capped at 35 when a rule-based hard blocker applies.
   - The **Best match** and **AI average score** sorts rank by these values.

## Retries and fallbacks

All slots run in parallel. Within a slot:

| What happened | What Élan does |
| --- | --- |
| Rate limit (429), timeout, provider error (5xx), network error | Retries the same model once: after `Retry-After` if OpenRouter sends it (at most 15 s), otherwise after 2 s. Then tries the next fallback. |
| Context window too small (checked before calling, or reported by the model) | Moves straight to the next fallback. |
| Answer cut off at the output limit, or invalid answer | Moves to the next fallback. The answer was billed and is accounted for. |
| Model unavailable (404 or 503, or not listed by OpenRouter), refused (403), out of credits (402), rejected request (400) | Moves to the next fallback. |
| API key rejected (401) or daily AI limit reached | Stops this scoring, and the search run stops scoring. |

Other limits:
- **One score per slot.** Each slot produces at most one score. A model already used by another slot is never reused as a fallback, so the average always combines independent evaluations.
- **Time limit.** Each slot has a 150-second limit, and each call has a 60-second timeout.
- **Fewer than three scores.** The average uses the models that answered, and the job page shows *Reduced coverage: 2 of 3 models*.
- **No valid score.** The scoring is stored as failed and the job keeps its previous score. No estimate is made.
- **Search runs.** A search run stops scoring after two jobs in a row fail on every model.

## Cost control

- **Request limit.** Every model call counts as one request against **Daily AI requests**. A job therefore uses at least three requests.
- **Cost limit.** Before each call, Élan reserves its worst-case cost against the **Daily AI budget**: the estimated input tokens plus 4,000 output tokens, at OpenRouter's price.
  - A finished call counts at the cost OpenRouter reports.
  - A call that failed without being billed (for example a 429) is released and doesn't count.
  - A call whose outcome is unknown (a timeout or a dropped connection) keeps its reservation.
  - If OpenRouter's model list can't be read, models are called without the availability check, and reservations use a deliberately high price of $15 / $75 per million input / output tokens.
- **No repeat scoring.** A job is not scored twice for the same input. The input hash covers the rubric version and the exact data sent to the models. Editing a job's text, the profile or a search profile's titles, work styles, locations or contracts makes the next run score it again; renaming a profile or changing its sources doesn't. **Re-run multi-model scoring** on a job page always scores again.

## Where results are stored

| Table | Contents |
| --- | --- |
| `JobScoring` | One row per job and input hash: status (`RUNNING`, `COMPLETE`, `PARTIAL`, `FAILED`), exact average, slots planned and scored, tokens, cost, error. |
| `JobModelScore` | One row per slot: the primary model, the model that actually answered (as reported by OpenRouter), score, validated answer, every attempt with its error code and latency, tokens, cost, and whether a fallback answered. |
| `AIUsage` | One row per model call, used for the daily limits. |

Both services write log lines without personal data:
- `ai_scoring_attempt` for each call: model, outcome, error code, latency, tokens, cost, and the next action (retry, next model or stop).
- `ai_scoring_job` for each job: status, average, coverage, totals.

## Where it shows

- **Job page.** The **Multi-model AI score** panel shows:
  - progress while the models answer
  - each slot's model and score, with a fallback badge when a fallback answered
  - the final average and its coverage
  - each model's dimension scores, requirement checks and summary
  - every attempt with its reason
- **Job list.** Each row shows the AI average and how many models produced it.
- **Settings.** **Settings → AI matching** lists the configured models and fallbacks.

## Tests

| Command | What it covers |
| --- | --- |
| `npm test` | `tests/multi-model-scoring.test.ts`: the rubric arithmetic, validation, every fallback path and the OpenRouter request format and error classification.<br>`tests/integration/multi-model-scoring.test.ts` (needs PostgreSQL): full search runs with a simulated OpenRouter, covering storage, caching, budget, duplicates across sources and source selection. |
| `npm run e2e:scoring` (after `npm run build`) | Drives the job page through the production build and the worker against a local fake OpenRouter, from **Run multi-model scoring** to the ranked list. It needs no key and costs nothing. |

These tests don't call the real OpenRouter. The first live check is to set `OPENROUTER_API_KEY` on both Railway services and press **Run multi-model scoring** on one job.
