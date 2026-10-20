'use client';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Bookmark, EyeOff, ExternalLink, FileText, RefreshCw, RotateCcw } from 'lucide-react';
import { ModelScoring } from '@/components/model-scoring';
import { Badge, EmptyState, Feedback, JobState, Loading, MatchBreakdown, Score, SourceBadges } from '@/components/ui';
import { ago, api, date, errorMessage, humanize, salary, useResource } from '@/lib/client';
import { Tracker } from '@/components/tracker';
import type { Job, Settings } from '@/lib/ui-types';

type Doc = { id: string; kind: string; language: string; version: number; model: string | null; markdown: string; evidenceUsed: string[] | null; suggestedLearning: string[] | null; createdAt: string };

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  // While a multi-model scoring runs (or was just requested) the page refreshes every 3 s to show each model as it answers.
  const [awaiting, setAwaiting] = useState<{ since: number; previousId: string | null } | null>(null), [running, setRunning] = useState(false);
  const { data: job, error, loading, refresh } = useResource<Job>(`/api/jobs/${id}`, running || awaiting ? 3000 : 0);
  const latest = job?.scorings?.[0] ?? null;
  useEffect(() => { setRunning(latest?.status === 'RUNNING'); if (awaiting && ((latest && latest.id !== awaiting.previousId && latest.status !== 'RUNNING') || Date.now() - awaiting.since > 240_000)) setAwaiting(null); }, [latest, awaiting]);
  const { data: settings } = useResource<Settings>('/api/settings');
  const [pendingSince, setPendingSince] = useState<number | null>(null);
  const docsResource = useResource<{ documents: Doc[] }>(`/api/jobs/${id}/documents`, pendingSince ? 4000 : 0);
  const [message, setMessage] = useState(''), [failed, setFailed] = useState(false), [busy, setBusy] = useState(''), [language, setLanguage] = useState<'fr' | 'en'>('fr');
  useEffect(() => { if (pendingSince && docsResource.data?.documents.some(doc => new Date(doc.createdAt).getTime() >= pendingSince - 2000)) setPendingSince(null); if (pendingSince && Date.now() - pendingSince > 120_000) setPendingSince(null); }, [docsResource.data, pendingSince]);
  const multiModel = settings?.scoring.configured ?? false; const aiReady = (settings?.ai.configured ?? false) || multiModel; const documentsReady = settings?.ai.configured ?? false;
  async function run(label: string, path: string, body: unknown = {}, success?: string) {
    setBusy(label); setMessage(''); setFailed(false);
    try { await api(`/api/jobs/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) }); setMessage(success ?? 'Updated.'); refresh(); docsResource.refresh(); return true; }
    catch (reason) { setFailed(true); setMessage(errorMessage(reason)); return false; } finally { setBusy(''); }
  }
  if (loading) return <Loading />;
  if (!job) return <Feedback message={error || 'Job not found.'} error />;
  const analysis = job.analyses?.[0]?.result; const details = job.matchDetails; const closed = job.status !== 'ACTIVE';
  const scoredModels = job.aiAverageScore !== null && job.aiAverageScore !== undefined && latest && latest.status !== 'RUNNING' && latest.status !== 'FAILED' ? latest.slotsScored : 0;
  const analyze = async () => { const previousId = latest?.id ?? null; if (await run('analyze', 'analyze', {}, multiModel ? 'Scoring queued. Each model’s result appears below as soon as it answers.' : 'AI analysis queued. It appears here when ready.') && multiModel) setAwaiting({ since: Date.now(), previousId }); };
  const analyzeLabel = multiModel ? (latest ? 'Re-run multi-model scoring' : 'Run multi-model scoring') : analysis ? 'Re-run AI analysis' : 'Run AI analysis';
  const docs = docsResource.data?.documents ?? [];
  return <div className="section-stack">
    <section className="panel detail-hero">
      <div>
        <div className="eyebrow">{job.companyName}</div><h1>{job.title}</h1>
        <p>{job.location || 'Location not stated'} · {humanize(job.remoteType)} · {humanize(job.contractType)} · {salary(job.salaryMin, job.salaryMax, job.salaryCurrency)}</p>
        <div className="job-meta"><SourceBadges job={job} /><JobState job={job} /><span className="table-secondary" style={{ margin: 0 }}>Published {date(job.publishedAt)} · found {ago(job.discoveredAt)} · last confirmed {ago(job.lastSeenAt)}</span></div>
        <div className="actions">
          <a className="button" href={job.applicationUrl || job.sourceUrl} target="_blank" rel="noopener noreferrer">Open the application page <ExternalLink size={15} /></a>
          <button className="button secondary" disabled={busy === 'save'} onClick={() => run('save', 'save', {}, 'Saved to your pipeline.')}><Bookmark size={15} /> Save</button>
          {job.dismissedAt ? <button className="button secondary" onClick={() => run('dismiss', 'dismiss', { dismissed: false }, 'Restored.')}><RotateCcw size={15} /> Restore</button> : <button className="button secondary" onClick={() => run('dismiss', 'dismiss', { dismissed: true }, 'Dismissed. You will not be notified about it.')}><EyeOff size={15} /> Dismiss</button>}
          <button className="button secondary" disabled={!aiReady || busy === 'analyze' || running} title={aiReady ? undefined : 'AI is not configured; the rule-based breakdown below is always available.'} onClick={analyze}><RefreshCw size={15} className={running ? 'spin' : undefined} /> {running ? 'Scoring…' : analyzeLabel}</button>
        </div>
      </div>
      <Score score={job.rankScore} ai={job.matchScore !== null} models={scoredModels} />
    </section>
    <Feedback message={message || error} error={failed || Boolean(error)} />
    {closed && <div className="feedback feedback-error" role="status"><span>This vacancy is {job.status === 'EXPIRED' ? 'past its validity date' : 'no longer listed by its source'}{job.statusChangedAt ? ` (since ${date(job.statusChangedAt)})` : ''}. The application link may no longer work.</span></div>}

    <section className="panel"><div className="panel-head"><h2>Why this score</h2><Badge tone="blue">Rule-based · works without AI</Badge></div><div className="panel-body">{details ? <MatchBreakdown details={details} /> : <p className="table-secondary">This job has not been scored yet. Scores are computed when a search stores it, and again whenever you change your profile.</p>}</div></section>

    {latest ? <ModelScoring scoring={latest} jobAverage={job.aiAverageScore ?? null} /> : multiModel && !analysis ? <section className="panel"><EmptyState icon="sparkles" title="Not scored by the AI models yet" description={`Three independent models (${settings!.scoring.slots.map(slot => slot.models[0]).join(', ')}) score this job on the same rubric; the final score is their average. It spends part of your daily AI budget.`} action={<button className="button" disabled={busy === 'analyze'} onClick={analyze}>Run multi-model scoring</button>} /></section> : null}

    {analysis ? <section className="panel"><div className="panel-head"><h2>AI analysis</h2><Badge tone={analysis.applicationRecommendation.includes('APPLY') ? 'green' : 'amber'}>{humanize(analysis.applicationRecommendation)} · {Math.round(analysis.confidence * 100)}% confidence</Badge></div>
      <div className="panel-body analysis-grid"><aside><Score score={analysis.overallMatchScore} ai /><p>{analysis.summary}</p>{analysis.hardRequirementsMissing.length > 0 && <><h3>Hard requirements missing</h3><div className="pill-list">{analysis.hardRequirementsMissing.map(item => <span className="pill pill-gap" key={item}>{item}</span>)}</div></>}{analysis.potentialRedFlags.length > 0 && <><h3>Red flags</h3><div className="pill-list">{analysis.potentialRedFlags.map(item => <span className="pill" key={item}>{item}</span>)}</div></>}<p className="table-secondary">{job.analyses?.[0]?.model} · {ago(job.analyses?.[0]?.createdAt)}</p></aside>
        <div>{Object.entries(analysis.dimensions).map(([name, dimension]) => <div className="dimension" key={name}><div className="dimension-head"><span>{humanize(name.replace(/([A-Z])/g, '_$1'))}</span><strong>{dimension.score}/100</strong></div><p>{dimension.reasoning}</p></div>)}</div></div></section>
      : multiModel ? null : <section className="panel"><EmptyState icon="sparkles" title="No AI analysis" description={aiReady ? 'Ask the AI for a deeper, semantic comparison with your stored profile. It spends part of your daily budget.' : 'AI is optional. Add a model, key and token prices in the environment to enable it; the rule-based breakdown above does not need it.'} action={aiReady ? <button className="button" onClick={analyze}>Analyze this job</button> : undefined} /></section>}

    <Tracker job={job} onSaved={refresh} />
    <div className="grid two">
      <Documents docs={docs} aiReady={documentsReady} language={language} setLanguage={setLanguage} pending={Boolean(pendingSince)} busy={busy} onGenerate={async kind => { if (await run(`doc-${kind}`, 'documents', { kind, language }, 'Generation queued. The new version appears below when ready.')) setPendingSince(Date.now()); }} />
      <Checklist job={job} hasDocs={docs.length > 0} />
    </div>
    <section className="panel"><div className="panel-head"><h2>Sources</h2></div><div className="panel-body">{job.sources?.map(source => <p key={source.sourceUrl}><a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">{humanize(source.provider)} <ExternalLink size={13} /></a>{source.removedAt && <span className="table-secondary"> · no longer listed</span>}</p>)}</div></section>
    <section className="panel"><div className="panel-head"><h2>Full job description</h2></div><div className="panel-body prose">{job.descriptionClean || 'No description was provided by the source.'}</div></section>
  </div>;
}

function Documents({ docs, aiReady, language, setLanguage, pending, busy, onGenerate }: { docs: Doc[]; aiReady: boolean; language: 'fr' | 'en'; setLanguage: (value: 'fr' | 'en') => void; pending: boolean; busy: string; onGenerate: (kind: 'cv' | 'cover-letter') => void }) {
  return <section className="panel"><div className="panel-head"><h2>Application documents</h2>{pending && <Badge tone="blue">Generating…</Badge>}</div><div className="panel-body">
    <p className="table-secondary" style={{ marginTop: 0 }}>Drafts use only facts from your reviewed profile and your original CV is never changed. Review every document before sending; Élan never submits applications for you.</p>
    <div className="actions" style={{ marginTop: 0 }}>
      <label className="field" style={{ minWidth: 120 }}><span>Language</span><select value={language} onChange={event => setLanguage(event.target.value as 'fr' | 'en')}><option value="fr">Français</option><option value="en">English</option></select></label>
      <button className="button secondary" disabled={!aiReady || Boolean(busy)} onClick={() => onGenerate('cv')} title={aiReady ? undefined : 'Requires AI configuration'}><FileText size={15} /> CV tailoring suggestions</button>
      <button className="button secondary" disabled={!aiReady || Boolean(busy)} onClick={() => onGenerate('cover-letter')} title={aiReady ? undefined : 'Requires AI configuration'}><FileText size={15} /> Cover letter</button>
    </div>
    {!aiReady && <p className="table-secondary">Document generation needs an AI model configured in the environment.</p>}
    {docs.map(doc => <details className="job-card" key={doc.id}><summary><strong>{humanize(doc.kind)} · {doc.language.toUpperCase()} · v{doc.version}</strong> <span className="table-secondary" style={{ display: 'inline' }}>{ago(doc.createdAt)}{doc.model ? ` · ${doc.model}` : ''}</span></summary>
      <pre className="doc-preview">{doc.markdown}</pre>
      {doc.suggestedLearning && doc.suggestedLearning.length > 0 && <><h3>Desirable but not in your profile (not claimed)</h3><div className="pill-list">{doc.suggestedLearning.map(item => <span className="pill pill-gap" key={item}>{item}</span>)}</div></>}
      {doc.evidenceUsed && doc.evidenceUsed.length > 0 && <details><summary className="table-secondary">Profile evidence used ({doc.evidenceUsed.length})</summary><ul className="evidence-list">{doc.evidenceUsed.map(item => <li key={item} className="ev-ok"><span>{item}</span></li>)}</ul></details>}
      <div className="actions">{['md', 'docx', 'pdf', 'html'].map(format => <a key={format} href={`/api/documents/${doc.id}/export?format=${format}`} className="button secondary">{format.toUpperCase()}</a>)}</div></details>)}
  </div></section>;
}

function Checklist({ job, hasDocs }: { job: Job; hasDocs: boolean }) {
  const key = `elan-checklist-${job.id}`; const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setDone(JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, boolean>); } catch { /* storage unavailable */ } }, [key]);
  const toggle = (item: string) => setDone(current => { const next = { ...current, [item]: !current[item] }; try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage unavailable */ } return next; });
  const details = job.matchDetails;
  const items = useMemo(() => [
    'Open the original posting and confirm it is still accepting applications',
    details?.matchedSkills.length ? `Tailor your CV to lead with: ${details.matchedSkills.slice(0, 5).map(item => item.skill).join(', ')}` : 'Tailor your CV to the posting’s key requirements',
    ...(details?.missingSkills.length ? [`Decide how to address the gaps: ${details.missingSkills.slice(0, 4).join(', ')} (do not claim skills you lack)`] : []),
    ...(details?.uncertain.some(text => /language|authori[sz]ation/i.test(text)) ? ['Verify language and work-authorization requirements with the employer'] : []),
    ...(job.salaryMin === null && job.salaryMax === null ? ['Prepare your salary expectation (none is stated)'] : []),
    hasDocs ? 'Review the generated documents line by line against your real experience' : 'Generate and review a cover letter and CV suggestions (optional)',
    'Submit through the employer’s application page, then mark the job as Applied',
    'Set a follow-up date for one week later'
  ], [details, job.salaryMin, job.salaryMax, hasDocs]);
  return <section className="panel"><div className="panel-head"><h2>Preparation checklist</h2><span className="table-secondary">{items.filter(item => done[item]).length}/{items.length}</span></div><div className="panel-body"><ul className="checklist">{items.map(item => <li key={item}><label className={done[item] ? 'done' : ''}><input type="checkbox" checked={Boolean(done[item])} onChange={() => toggle(item)} /><span>{item}</span></label></li>)}</ul><p className="table-secondary">Checks are remembered in this browser only.</p></div></section>;
}
