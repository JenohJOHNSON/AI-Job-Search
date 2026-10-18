# Deployment guide

Target: **Railway** for the web service, the background worker and PostgreSQL; **GitHub Actions** for CI and an optional backup trigger. Everything below is prepared and tested in this repository, but creating the accounts and services requires you. Nothing here claims an existing live deployment.

## What the repository already provides

| Artifact | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage build with non-root `web` (default, last stage) and `worker` targets. Both run `prisma migrate deploy` before starting. |
| `railway.json` | Web service: Docker target `web`, health check `/api/health`, restart on failure. |
| `railway.worker.json` | Worker service: Docker target `worker`, restart on failure. |
| `prisma/migrations` | Additive migrations, applied automatically on every start. |
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
2. **Web service.** *New → GitHub repo → this repository.* `railway.json` selects the `web` Docker target and `/api/health`.
   - Variables: `DATABASE_URL` (reference the PostgreSQL service's connection URL), `SETUP_SECRET`, `JOB_RUNNER_SECRET`, plus any optional variables from `.env.example`.
   - Generate a public domain, set its target port to **3000**, then set `APP_URL` to that exact HTTPS origin (no trailing slash) and redeploy. `APP_URL` is used for same-origin checks, so a wrong value makes every write return 403.
3. **Worker service.** *New → GitHub repo → the same repository* again. In the service settings set **Config as Code** to `/railway.worker.json`. Give it the **same** variables (`DATABASE_URL`, secrets, AI and notification variables). It needs no domain and no port.
4. **Order.** Both images run `prisma migrate deploy` on start; migrations are additive, so deploy order does not matter.
5. **Owner account.** Open the public URL. The first screen asks for email, a password (12+ characters) and the `SETUP_SECRET`. Choose a unique password. Only one owner can ever be created.
6. **Optional backup trigger.** The worker already runs the daily search by itself (Settings → Daily search). To also trigger it from GitHub, add the repository secrets `APP_URL` and `JOB_RUNNER_SECRET` and run **Daily job search** once with *Run workflow*. Automated triggers are skipped when a search finished in the last three hours, so the two never produce duplicate runs.

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
| Health check fails | `DATABASE_URL` wrong or database unreachable; check the web logs for the migration step. |
| Setup says the secret is invalid | `SETUP_SECRET` differs between what you typed and the variable. |
| Run stays queued | Worker service missing, crashed, or on another database. |
| Digest never arrives | Channel not enabled in Settings, transport variables missing, or no new job above the threshold (each job is announced once). |
