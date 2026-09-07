# UI integration contract

All API responses are JSON. Errors: `{error:string}`. Private APIs require a session cookie. Writes same origin. No production fixture data. UI may fetch authenticated APIs client-side and show empty/loading/error states.

- GET /api/auth/session -> `{user:{id,email}|null, setupRequired:boolean}`
- POST /api/auth/setup `{email,password,setupSecret}`; POST /api/auth/login `{email,password}`; POST /api/auth/logout `{}`.
- GET /api/dashboard -> `{stats:{newJobs,highMatches,analyzed,activeProviders,applications,failures}, topJobs:Job[], recentJobs:Job[], providers:Provider[], recentRuns:Run[], usage:{analyses,cost}}`
- GET /api/jobs supports `q,score,provider,company,location,remoteType,salaryMin,contractType,publishedDays,discoveredDays,status,sort,page`; sort score/newest/salary/company/published; returns `{jobs:Job[],total,page,pageSize}`.
- POST /api/jobs manual normalized data `{title,companyName,location,descriptionClean,sourceUrl,applicationUrl?,remoteType?,contractType?,salaryMin?,salaryMax?}` -> Job.
- GET /api/jobs/:id -> Job incl `sources`, `analyses`, `application` incl `history`.
- POST /api/jobs/:id/analyze -> `{queued:true}`; POST /api/jobs/:id/save -> Application.
- POST /api/jobs/:id/application `{status,notes?,salaryDiscussed?,contact?,nextAction?,nextActionDate?,interviewDates?}` -> Application.
- POST /api/jobs/:id/documents `{kind:'cv'|'cover-letter',language:'fr'|'en'}` -> `{queued:true,taskId}`; GET /api/jobs/:id/documents -> `{documents:[{id,kind,language,markdown,createdAt}]}`. GET /api/documents/:id/export?format=md|html|pdf for downloads.
- GET /api/applications -> `{applications:Application[]}` each includes `job`.
- GET /api/profile -> `{profile:CandidateData,version:number,resumes:Resume[]}`; PUT /api/profile candidate object -> profile.
- POST /api/resume/upload multipart `file` -> `{resume:{id,fileName,...},suggestions:CandidateData|null,extractionStatus:string}`; extraction can be queued, GET profile to refresh. Suggestions never overwrite profile. Full edited profile saved only by PUT.
- GET /api/search/profiles -> `{profiles:SearchProfile[]}`; POST create; PUT /api/search/profiles/:id; DELETE same.
- POST /api/search/run `{}` -> `{runId,status}`; GET /api/search/runs -> `{runs:Run[]}`.
- GET /api/providers -> `{providers:Provider[]}`; PATCH /api/providers/:id `{enabled,maxJobs,rateLimitMs,config:{boards?:string[],urls?:string[],allowedHosts?:string[]},strategies?:string[]}`. Provider IDs greenhouse,lever,ashby,france_travail,generic,linkedin,indeed,hellowork,jobijoba,apec,wttj,cadremploi.
- GET /api/settings -> `{ai:{provider,model,configured},limits:{maxAiAnalysesPerDay,maxLlmCostPerDay,aiMatchThreshold,maxJobsPerProvider,maxTotalJobsPerRun,notificationScoreThreshold},notifications:{emailEnabled,telegramEnabled},schedule:{cron,timezone},appUrl}`. PATCH `{notifications:{emailEnabled,telegramEnabled}}`.
- GET /api/privacy/export downloads private JSON; DELETE /api/privacy `{confirmation:'DELETE MY DATA'}` removes personal profile/resumes/analyses/applications/documents and sessions.

## Common shapes

Job: `id,title,companyName,location,remoteType,contractType,salaryMin:number|null,salaryMax:number|null,salaryCurrency,sourceUrl,applicationUrl,descriptionClean,matchScore:number|null,preliminaryScore:number|null,publishedAt,discoveredAt,status (ACTIVE/EXPIRED/REMOVED),sources:[{provider,sourceUrl}],application:{status,...}|null,analyses:[{result:Analysis,model,createdAt}]`.
Analysis: `overallMatchScore,confidence,summary,dimensions:{roleMatch,skillsMatch,experienceMatch,industryMatch,locationMatch,compensationMatch,seniorityMatch,careerGrowthMatch}` each `{score,reasoning}`; `matchingSkills,missingSkills,transferableSkills,strongPoints,weakPoints,hardRequirementsMet,hardRequirementsMissing,potentialRedFlags,applicationRecommendation` (STRONG_APPLY/APPLY/MAYBE/SKIP).
Provider: `id,name,enabled,supported,maxJobs,rateLimitMs,strategies,config,status,message,lastSuccessAt,jobsDiscovered,errorRate`.
Run: `id,status,trigger,startedAt,completedAt,createdAt,providersAttempted,providersSuccessful,providersFailed,jobsDiscovered,jobsNew,jobsDuplicate,jobsAnalyzed,jobsHighMatch,errors,providerRuns`.
Application: `id,jobId,status,notes,salaryDiscussed,contact,nextAction,nextActionDate,interviewDates,appliedAt,history:[{fromStatus,toStatus,createdAt}]`.
Statuses: NEW,REVIEWED,SAVED,APPLY,APPLIED,RECRUITER_CONTACT,INTERVIEW,TECHNICAL_INTERVIEW,FINAL_INTERVIEW,OFFER,REJECTED,WITHDRAWN,ARCHIVED.
CandidateData flat: `preferredName,location,workAuthorization,languages:string[],currentTitle,yearsExperience:number,targetRoles,secondaryRoles,targetIndustries,preferredCompanyTypes,seniorityLevels,coreSkills,secondarySkills,tools,technologies,certifications,locations:string[],maxCommuteKm:number|null,remote:boolean,hybrid:boolean,onsite:boolean,relocation:boolean,travelTolerance,minimumSalary:number|null,preferredSalary:number|null,currency,contractTypes:string[],excludedCompanies,excludedIndustries,excludedTitles,excludedKeywords,careerSummary,achievements:string[],careerGoals,strengths:string[],weaknesses:string[],desiredNextStep`.
SearchProfile flat: `id,name,enabled,targetTitles:string[],alternativeTitles,keywords,excludedKeywords,locations,remotePreferences,salaryMin:number|null,contractTypes,seniority,datePostedWindow:number (days),providers:string[],minimumMatchScore:number`.
