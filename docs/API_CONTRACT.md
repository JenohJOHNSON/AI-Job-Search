# API contract

All responses are JSON unless a download. Errors: `{error:string}` with an accurate status (400 validation, 401 unauthenticated, 403 origin/secret, 404, 409 not configured, 413, 422 unreadable input, 429 rate limited, 502 upstream). Every private route requires the session cookie; state-changing routes also check the request origin. A test enforces both.

## Auth

- `GET /api/auth/session` → `{user:{id,email}|null, setupRequired}`
- `POST /api/auth/setup` `{email,password(12+),setupSecret}` (once; rate limited) · `POST /api/auth/login` `{email,password}` · `POST /api/auth/logout`

## Dashboard and settings

- `GET /api/dashboard` → `{stats:{total,newJobs,highMatches,saved,submitted,interviewing,upcomingInterviews,activeProviders,failures,lastSearchAt}, topJobs, recentJobs, providers, recentRuns, upcomingInterviews[], followUps[], usage:{analyses,cost,maxAnalyses,maxCost,configured}, threshold, setup:{profile,searchProfile,source,firstRun,ai,notifications}}`
- `GET /api/settings` → `{ai:{provider,model,configured,missing[],fallbackModel}, limits, ceilings, notifications:{emailEnabled,telegramEnabled,minScore,maxPerDigest,emailAvailable,telegramAvailable}, schedule:{enabled,time,timezone}, appUrl}`
- `PATCH /api/settings` `{notifications?:{emailEnabled,telegramEnabled,minScore,maxPerDigest}, schedule?:{enabled,time:"HH:MM",timezone}, ai?:{maxAnalysesPerDay,maxCostPerDay,matchThreshold}, limits?:{maxJobsPerProvider,maxTotalJobsPerRun}}` (all fields optional; values above the environment ceilings are capped on read)
- `POST /api/settings/notifications/test` `{channel:"EMAIL"|"TELEGRAM"}` → `{sent:true}` or 502

## Jobs

- `GET /api/jobs` filters: `q, score (min rank score), provider, company, location, remoteType, salaryMin, contractType, status (application stage), publishedDays, discoveredDays, view (active|saved|dismissed|closed|all), sort (score|newest|published|freshness|salary|company), page, pageSize` → `{jobs:Job[],total,page,pageSize}`. Unknown values are ignored.
- `POST /api/jobs` manual posting `{title,companyName,location?,descriptionClean,sourceUrl,applicationUrl?,remoteType?,contractType?,salaryMin?,salaryMax?}` → Job (scored)
- `POST /api/jobs/import-url` `{url}` → `{imported:[{id,title,duplicate}]}`; 422 for restricted platforms or pages without structured data
- `GET /api/jobs/:id` → Job with `sources`, `analyses`, `application{history}`
- `POST /api/jobs/:id/save` (never downgrades progress) · `POST /api/jobs/:id/dismiss` `{dismissed}` · `POST /api/jobs/:id/analyze` (multi-model scoring when `OPENROUTER_API_KEY` is set, else the single-model analysis; 409 when AI is not configured or the job is already being scored)
- `POST /api/jobs/:id/application` `{status,notes?,salaryDiscussed?,contact?,nextAction?,nextActionDate?,interviewDates?[]}` → Application
- `POST /api/jobs/:id/documents` `{kind:"cv"|"cover-letter",language:"fr"|"en"}` → 202 `{queued,taskId}` (409 without AI) · `GET` → `{documents:[{id,kind,language,version,model,markdown,evidenceUsed,suggestedLearning,createdAt}]}`
- `GET /api/documents/:id/export?format=md|html|pdf|docx`
- `GET /api/applications` → `{applications:[Application with job]}`

## Profile and resume

- `GET /api/profile` → `{profile,version,resumes[]}` · `PUT /api/profile` (full reviewed profile; queues a re-score)
- `POST /api/resume/upload` multipart `file` (PDF, DOCX, Markdown or text, ≤ 5 MB) → 202 `{resume,extractionStatus}`; statuses `QUEUED`, `PENDING_REVIEW`, `AI_NOT_CONFIGURED`, `EXTRACTION_FAILED`. Suggestions never overwrite the profile.
- `GET /api/resume/:id/download` → the original upload

## Search and sources

- `GET|POST /api/search/profiles` · `PUT|DELETE /api/search/profiles/:id` (each change queues a re-score)
- `POST /api/search/run` → 202 `{runId,status}` · `GET /api/search/runs` → `{runs:[Run with providerRuns]}`
- `POST /api/internal/jobs/run` bearer `JOB_RUNNER_SECRET`, optional `Idempotency-Key` → 202; skipped when a run finished in the last 3 hours
- `GET /api/providers` → `{providers:[Provider]}` · `PATCH /api/providers/:id` `{enabled,maxJobs,rateLimitMs,config:{boards[],urls[],allowedHosts[]}}` (board URLs are reduced to names; URLs must be HTTPS and in `allowedHosts`) · `POST /api/providers/:id/check` → `{status,detail}`

## Privacy

- `GET /api/privacy/export` · `DELETE /api/privacy` `{confirmation:"DELETE MY DATA"}`
- `GET /api/health` → `{status,database}` (public)

## Shapes

Job: `id,title,companyName,location,remoteType,contractType,salaryMin,salaryMax,salaryCurrency,sourceUrl,applicationUrl,descriptionClean,rankScore,matchScore,preliminaryScore,matchLabel,matchDetails{score,label,confidence,components[{key,label,score,max,evidence[],gaps[],uncertain[]}],matchedSkills[{skill,evidence}],missingSkills[],transferableSkills[],blockers[],uncertain[],summary},publishedAt,discoveredAt,lastSeenAt,statusChangedAt,dismissedAt,status(ACTIVE|EXPIRED|REMOVED),sources[],application,analyses[]`.
Analysis (AI): `overallMatchScore,confidence,summary,dimensions{roleMatch,skillsMatch,experienceMatch,industryMatch,locationMatch,compensationMatch,seniorityMatch,careerGrowthMatch},matchingSkills,missingSkills,transferableSkills,strongPoints,weakPoints,hardRequirementsMet,hardRequirementsMissing,potentialRedFlags,applicationRecommendation`.
Provider: `id,name,enabled,supported,maxJobs,rateLimitMs,config,method,description,credentialsConfigured,status,message,lastSuccessAt,jobsDiscovered,errorRate`.
Run: `id,status(QUEUED|RUNNING|FINISHED|FAILED),trigger,startedAt,completedAt,providersAttempted,providersSuccessful,providersFailed,jobsDiscovered,jobsNew,jobsDuplicate,jobsAnalyzed,jobsHighMatch,errors[{provider,code,message}],providerRuns[{provider,status,jobsDiscovered,errorMessage,durationMs,extractorStats}]`.
Application statuses: `NEW,REVIEWED,SAVED,APPLY,APPLIED,RECRUITER_CONTACT,INTERVIEW,TECHNICAL_INTERVIEW,FINAL_INTERVIEW,OFFER,REJECTED,WITHDRAWN,ARCHIVED`.
CandidateData and SearchProfile: see `lib/schemas.ts`.
