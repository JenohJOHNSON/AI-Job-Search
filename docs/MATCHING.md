# Matching

Every stored vacancy gets a transparent **0–100 score** from a deterministic engine (`matching/score.ts`). It needs no AI key, runs in microseconds, is recomputed whenever you change your profile or a search profile, and returns the evidence behind each point. An AI model can refine the score of the best candidates, but it can never lift a job past a hard blocker.

## Labels

| Score | Label |
| --- | --- |
| 80–100 | Strong Match |
| 65–79 | Good Match |
| 50–64 | Possible Match |
| below 50 | Low Match |

## Components (weights add up to 100)

| Component | Weight | What is checked |
| --- | ---: | --- |
| Role fit | 22 | Job title against your target roles, secondary roles and the search profile's titles. French and English synonyms are grouped into role families (data engineer / ingénieur data, développeur ETL / SSIS / Talend, SQL Server, Azure data, DevOps, C++, data analyst, business analyst, product definition analyst). Related titles count slightly less than target titles. |
| Skills & technologies | 30 | Technologies found in the posting (about 70 canonical technologies with spelling variants, e.g. `T-SQL` = SQL Server) against skills in **your reviewed profile**. Skills in the title weigh more, “nice to have” sections less. Skills of the same family (SSIS ↔ Talend, Docker ↔ Kubernetes, …) earn partial credit and are listed as *transferable*, never as matched. |
| Experience & seniority | 10 | Years requested (`3 ans d'expérience`, `5+ years`) against your years; job level from the title (junior, senior, lead, director). Two or more levels above your experience caps the score at 60. |
| Location & work style | 20 | Distance from your preferred places using city coordinates (Nancy, Metz, Luxembourg, Grand Est and others), your maximum commute (default 70 km), cross-border Luxembourg commutes, remote scope (France / Europe / elsewhere), hybrid and on-site preferences. Remote is inferred from the text when the source does not state it. Hybrid still needs regular presence, so only fully remote roles ignore distance. |
| Language & authorization | 5 | Languages the posting requires (or is written in) against your languages; mentions of work authorization are flagged for you to verify, never assumed. |
| Salary | 5 | Stated range against your minimum. Unknown stays unknown; hourly or implausible values are ignored. |
| Contract | 5 | CDI/CDD/freelance/internship/apprenticeship against your preferences. |
| Search keywords | 3 | Interest keywords from your search profile (a nudge, never evidence of ability). |

## Hard blockers (score capped at 35)

Excluded keywords, companies, titles or industries from your profile and search profiles · maximum stated salary below your minimum · internship or apprenticeship when you do not seek one · a required language you do not list (German, Dutch, …) · on-site or hybrid location far outside your commute range (unless you are open to relocation) · remote roles restricted to a region outside Europe.

## Honesty rules

- A skill is credited only when it appears in your reviewed profile; the evidence string names the field (`coreSkills: SSIS`).
- Missing information is reported as *uncertain*, not scored as a match or a failure.
- With an empty profile the engine reports what is missing instead of inventing a good score.
- AI output is schema-validated; matching and transferable skills it returns are filtered to skills already in your profile; blockers cap the final ranking score.

## Stored data

`Job.preliminaryScore` and `Job.matchDetails` hold the rule-based result and its evidence; `Job.matchScore` holds the AI score when present (with multi-model scoring, the rounded average; `Job.aiAverageScore` keeps it to two decimals, see [AI_SCORING.md](AI_SCORING.md)); `Job.rankScore` is what the interface sorts, filters and notifies on (the AI score, capped by blockers, else the rule-based score). `matchProfileVersion` records which profile version produced it.

## Semantic matching

Embeddings are deliberately not used: the synonym and family tables capture the FR/EN vocabulary of the target roles reliably and cheaply. The optional AI step adds semantic judgement where it has measurable value (the top candidates), with caching and a daily budget.
