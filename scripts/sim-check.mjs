// Post-deployment check against a running instance: owner setup, CV upload through the sandboxed parser,
// a manual vacancy, and a worker-processed run. Used to validate container-style layouts.
//   BASE_URL=http://127.0.0.1:3000 SETUP_SECRET=... node scripts/sim-check.mjs
const base = process.env.BASE_URL; let cookie = ""; let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed++; };
async function call(method, path, body, form) {
  const response = await fetch(`${base}${path}`, { method, headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(form ? {} : { "Content-Type": "application/json" }) }, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const set = response.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
  return { status: response.status, data: await response.json().catch(() => null) };
}
const setup = await call("POST", "/api/auth/setup", { email: "sim@example.test", password: "sim-password-123456", setupSecret: process.env.SETUP_SECRET });
check("owner setup", setup.status === 201, `HTTP ${setup.status}`);
// A minimal but valid single-page PDF.
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 53>>stream\nBT /F1 14 Tf 10 50 Td (Simulated CV: SSIS and SQL Server) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF");
const form = new FormData(); form.append("file", new Blob([pdf], { type: "application/pdf" }), "cv.pdf");
const upload = await call("POST", "/api/resume/upload", undefined, form);
check("PDF parsed by the sandboxed worker thread", upload.status === 202 || upload.status === 422, `HTTP ${upload.status} ${upload.data?.error ?? upload.data?.extractionStatus ?? ""}`);
const doc = await call("POST", "/api/jobs", { title: "Ingénieur Data", companyName: "Sim SA", sourceUrl: "https://example.test/sim", descriptionClean: "SQL Server, SSIS. CDI.", location: "Metz" });
check("manual vacancy stored", doc.status === 201, `HTTP ${doc.status}`);
const run = await call("POST", "/api/search/run"); check("run queued", run.status === 202);
let finished; for (let i = 0; i < 30 && !finished; i++) { await new Promise(r => setTimeout(r, 1000)); finished = (await call("GET", "/api/search/runs")).data?.runs?.find(item => item.id === run.data?.runId && ["FINISHED", "FAILED"].includes(item.status)); }
check("independent worker processed the run", Boolean(finished), finished ? `${finished.status}: ${JSON.stringify(finished.errors).slice(0, 110)}` : "timed out");
process.exit(failed ? 1 : 0);
