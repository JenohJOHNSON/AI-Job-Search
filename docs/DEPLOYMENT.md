# Deployment guide

Target: **Railway** for the web service, the background worker and PostgreSQL; **GitHub Actions** for CI and an optional backup trigger. Everything below is prepared and tested in this repository, but creating the accounts and services requires you. Nothing here claims an existing live deployment.

## What the repository already provides

| Artifact | Purpose |
| --- | --- |
| `Dockerfile` | Non-root web image (Next.js standalone server). `scripts/start-web.sh` runs `prisma migrate deploy` over a direct connection, then starts the server. |
| `Dockerfile.worker` | Non-root background worker image. Never migrates; waits, retrying, until the web image has. |
| `prisma/migrations` | Additive migrations, applied automatically when the web service starts. |
| `.github/workflows/ci.yml` | Lint, types, unit and PostgreSQL tests, build, browser e2e, and a job that builds both images, boots the web image against PostgreSQL and checks `/api/health` and that the worker keeps running. |
| `.github/workflows/daily-job-search.yml` | Optional backup trigger for the daily search. |
| `.github/workflows/live-smoke.yml` | Manual live smoke test against public job boards. |

## 1. External accounts and credentials

| What | Needed for | Where to get it | Required? |
| --- | --- | --- | --- |
| GitHub account with this repository | Railway source, CI | already yours | yes |
| Railway account (a paid plan is needed for always-on services) | hosting | railway.com | yes |
| PostgreSQL | state | Railway's PostgreSQL service, or any managed PostgreSQL 16 such as Neon (use `?sslmode=require`) | yes |
| France Travail API client | France job offers | create an application at francetravail.io, subscribe it to **Offres d'emploi v2**, copy client id and secret | optional |
| AI provider key and **exact** token prices | AI refinement, CV suggestions, cover letters | your provider's console; also set a spend limit there | optional |
| Resend API key (or SMTP URL) and a verified sender | email digests | resend.com | optional |
| Telegram bot token and chat id | Telegram digests | `@BotFather`, then message the bot and read your chat id | optional |

## 2. Railway

1. **Project and database.** Create a Railway project and add the **PostgreSQL** service.
2. **Web service.** *New → GitHub repo → this repository.* Railway detects the root `Dockerfile`. Railway's config-as-code files (`railway.json`) are deprecated, so everything below is a service setting or variable.
   - Variables: `DATABASE_URL` (reference the PostgreSQL service's connection URL), `SETUP_SECRET`, `JOB_RUNNER_SECRET`, `PORT=3000`, plus any optional variables from `.env.example`. Railway runs health checks against `PORT`; without it they fail with *service unavailable* although the app is up.
   - Migrations need a direct (non-pooled) connection so that Prisma's migration lock is reliably released. With a Neon pooled `DATABASE_URL` (host containing `-pooler`) nothing is needed: the web image derives Neon's direct host by removing `-pooler`. With another transaction-mode pooler (PgBouncer), set `DIRECT_URL` to the direct connection string.
   - Settings: health check path `/api/health`. Generate a public domain, set its target port to **3000**, then set `APP_URL` to that exact HTTPS origin (no trailing slash) and redeploy. `APP_URL` is used for same-origin checks, so a wrong value makes every write return 403.
3. **Worker service.** *New → GitHub repo → the same repository* again. Add the variable `RAILWAY_DOCKERFILE_PATH=Dockerfile.worker` (Railway always builds a Dockerfile's last stage and has no target setting). Give it the **same** variables, most simply as references such as `${{<web service>.DATABASE_URL}}`. It needs no domain, no port and no `DIRECT_URL`.
4. **Order.** Only the web service applies migrations. A worker that starts first logs `worker_loop_error` and retries with backoff until the schema is current, so deploy order does not matter.
5. **Owner account.** Open the public URL. The first screen asks for email, a password (12+ characters) and the `SETUP_SECRET`. Choose a unique password. Only one owner can ever be created.
6. **Optional backup trigger.** The worker already runs the daily search by itself (Settings → Daily search). To also trigger it from GitHub, add the repository secrets `APP_URL` (the public `https://` origin of the web service) and `JOB_RUNNER_SECRET` (the same value as in Railway) and run **Daily job search** once with *Run workflow*. Until both secrets exist the workflow skips with a warning instead of failing. Automated triggers are skipped when a search finished in the last three hours, so the two never produce duplicate runs.

## 3. Verify the deployment

Do these in order; only the last one proves that background work is running.

1. `GET <APP_URL>/api/health` returns `{"status":"ok","database":"ok",...}`.
2. You can create the owner and sign in; signing out and back in works.
3. In **Job sources** add a Greenhouse, Lever or Ashby board and press **Check connection**: it should show `Healthy` with an opening count. For France Travail the check confirms the credentials.
4. Complete your profile and a search profile, enable the source, press **Run job search**. The run should move from *Queued* to *Finished* within a minute or two on **Search history**, which lists what each source returned. If it stays queued, the worker is not running or points to a different database.
5. Jobs appear under **Discover jobs** with scores and an explanation.
6. (Optional) In **Settings** use *Send test email* / *Send test Telegram*.

The repository's own deployment checks that run without Railway: the CI `docker` job (images build, web boots, migrates and answers `/api/health`, worker keeps polling) and `npm run e2e` (production build, worker and browser journey).

## 4. Operating it

- **Cost control.** Hosting is the only fixed cost. AI is off until configured and is bounded by `MAX_AI_ANALYSES_PER_DAY` and `MAX_LLM_COST_PER_DAY`, which the owner can only lower in Settings. Also set a limit in the AI provider's console.
- **Backups.** Use Railway's PostgreSQL backups (or `pg_dump`). The only state is in PostgreSQL. Restoring a backup then deploying applies any newer migrations.
- **Migrations** are additive and never drop user data. The one relaxed constraint (`Notification` no longer unique per day) is replaced by per-job tracking.
- **Updating.** Push to the deployed branch. Both services rebuild; the worker finishes or releases its current task (leases are recovered automatically if it is killed).
- **Logs.** Both services write one JSON object per line without personal data or secrets (`worker_started`, `task_completed`, `provider_search`, `digest_sent`, …).
- **Rotating secrets.** Change `SETUP_SECRET` or `JOB_RUNNER_SECRET` in Railway and, for the latter, in the GitHub secret.

## 5. Troubleshooting a deployment

| Symptom | Likely cause |
| --- | --- |
| Every action says “Origin rejected” | `APP_URL` does not equal the public HTTPS origin. |
| Health check fails with *service unavailable* while the logs show `Ready` | `PORT=3000` missing on the web service, so Railway probes another port. |
| Health check fails | `DATABASE_URL` wrong or database unreachable; check the web logs for the migration step. |
| Web restarts with `P1002 … Timed out trying to acquire a postgres advisory lock` | Migrations run through a pooler that is not a Neon `-pooler` host, and a migration lock was left held. Set `DIRECT_URL` (non-pooled) on the web service. As a stopgap, `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=1` on the web service is acceptable while it runs a single replica, because only the web service migrates. |
| Setup says the secret is invalid | `SETUP_SECRET` differs between what you typed and the variable. |
| Run stays queued | Worker service missing, crashed, on another database, or built from `Dockerfile` instead of `Dockerfile.worker` (its logs then show Next.js starting). |
| Digest never arrives | Channel not enabled in Settings, transport variables missing, or no new job above the threshold (each job is announced once). |
