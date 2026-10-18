// End-to-end smoke test against a running web service and worker.
//   BASE_URL=http://localhost:3000 SETUP_SECRET=... node scripts/smoke.mjs
// It uses a synthetic candidate (not real personal data) and a few PUBLIC job boards, so it
// performs a genuine, bounded live provider request. Set SMOKE_BOARDS to override the boards.
try { process.loadEnvFile?.(); } catch { /* no .env file */ }

const base = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const email = process.env.SMOKE_EMAIL ?? "smoke-owner@example.test";
const password = process.env.SMOKE_PASSWORD ?? "smoke-test-password-123";
const boards = JSON.parse(process.env.SMOKE_BOARDS ?? JSON.stringify({ lever: ["mistral"], greenhouse: ["doctolib"], ashby: ["ledger"] }));
let cookie = "";
let failures = 0;

async function call(method, path, body, extra = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get("set-cookie"); if (setCookie) cookie = setCookie.split(";")[0];
  const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch { /* non-JSON response */ }
  return { status: response.status, data, text };
}
function check(name, condition, detail = "") { console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); if (!condition) failures++; return condition; }

const profile = {
  preferredName: "Smoke Test", location: "Metz", workAuthorization: "EU citizen (synthetic test data)", languages: ["French (native)", "English (professional)"],
  currentTitle: "Data Engineer", yearsExperience: 5, targetRoles: ["Data Engineer", "Ingénieur Data", "Développeur ETL"], secondaryRoles: ["DevOps Engineer", "Data Analyst"],
  coreSkills: ["SQL Server", "SSIS", "Python", "Azure Data Factory"], secondarySkills: ["Docker", "Power BI"], tools: ["Git", "Azure DevOps"], technologies: ["Azure", "Databricks"],
  locations: ["Metz", "Nancy", "Luxembourg", "Grand Est", "Remote France", "Remote Europe"], maxCommuteKm: 80, remote: true, hybrid: true, onsite: true, contractTypes: ["CDI"], minimumSalary: 38000
};
const searchProfile = { name: "Smoke data roles", targetTitles: ["Data Engineer", "Ingénieur Data"], alternativeTitles: ["Analytics Engineer", "DevOps Engineer", "Software Engineer"], keywords: ["SQL", "Python"], locations: ["Paris", "Remote", "Europe"], remotePreferences: ["REMOTE", "HYBRID"], datePostedWindow: 30, providers: ["lever", "greenhouse", "ashby"] };

const health = await call("GET", "/api/health"); check("health endpoint reports database ok", health.status === 200 && health.data?.database === "ok");
const session = await call("GET", "/api/auth/session"); check("session endpoint reachable", session.status === 200);
if (session.data?.setupRequired) {
  const secret = process.env.SETUP_SECRET; if (!secret) throw new Error("SETUP_SECRET is required for first-owner setup.");
  const setup = await call("POST", "/api/auth/setup", { email, password, setupSecret: secret }); check("owner setup", setup.status === 201, `HTTP ${setup.status}`);
} else {
  const login = await call("POST", "/api/auth/login", { email, password }); check("owner login", login.status === 200, `HTTP ${login.status}`);
}
const unauth = await fetch(`${base}/api/jobs`); check("private API rejects anonymous requests", unauth.status === 401, `HTTP ${unauth.status}`);
check("authenticated session", (await call("GET", "/api/auth/session")).data?.user?.email === email);

check("profile saved", (await call("PUT", "/api/profile", profile)).status === 200);
const created = await call("POST", "/api/search/profiles", searchProfile); check("search profile created", created.status === 201, `HTTP ${created.status}`);

const providers = await call("GET", "/api/providers"); check("providers listed", providers.status === 200 && Array.isArray(providers.data?.providers));
for (const [id, slugs] of Object.entries(boards)) {
  const patched = await call("PATCH", `/api/providers/${id}`, { enabled: true, maxJobs: 150, config: { boards: slugs } }); check(`provider ${id} configured`, patched.status === 200, `HTTP ${patched.status}`);
}

const run = await call("POST", "/api/search/run"); check("search run queued", run.status === 202, `HTTP ${run.status} ${run.data?.runId ?? ""}`);
let finished = null;
for (let attempt = 0; attempt < 90 && !finished; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 2000));
  const runs = await call("GET", "/api/search/runs"); finished = runs.data?.runs?.find(item => item.id === run.data?.runId && ["FINISHED", "FAILED"].includes(item.status)) ?? null;
}
check("worker finished the run", finished?.status === "FINISHED", finished ? `${finished.status}: discovered=${finished.jobsDiscovered} new=${finished.jobsNew} providers ok=${finished.providersSuccessful} failed=${finished.providersFailed}` : "timed out (is the worker running?)");
if (finished) for (const providerRun of finished.providerRuns ?? []) console.log(`      ${providerRun.provider}: ${providerRun.status} jobs=${providerRun.jobsDiscovered} ${providerRun.errorMessage ?? ""}`);

const jobs = await call("GET", "/api/jobs?sort=score"); check("jobs persisted and listed", jobs.status === 200 && jobs.data?.total > 0, `total=${jobs.data?.total ?? 0}`);
const first = jobs.data?.jobs?.[0];
if (first) {
  console.log(`      top job: ${first.title} @ ${first.companyName} (${first.location}) score=${first.matchScore ?? first.preliminaryScore ?? "n/a"}`);
  check("job has a direct application URL", /^https?:\/\//.test(first.applicationUrl ?? first.sourceUrl ?? ""));
  const again = await call("POST", "/api/search/run"); await new Promise(resolve => setTimeout(resolve, 15000));
  const after = await call("GET", "/api/jobs?sort=score"); check("a second run does not create duplicates", after.data?.total === jobs.data.total, `${jobs.data.total} -> ${after.data?.total} (run ${again.status})`);
}
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll smoke checks passed.");
process.exit(failures ? 1 : 0);
