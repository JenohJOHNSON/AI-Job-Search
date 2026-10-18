'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Bookmark, BookmarkCheck, ExternalLink, EyeOff, Link2, Plus, RotateCcw, Search } from 'lucide-react';
import { EmptyState, Feedback, Field, JobState, Loading, PageHeading, Score, SourceBadges, Tabs } from '@/components/ui';
import { ago, api, date, errorMessage, humanize, salary, useResource } from '@/lib/client';
import type { Job } from '@/lib/ui-types';

type View = 'active' | 'saved' | 'dismissed' | 'closed' | 'all';
type Filters = { q: string; score: string; provider: string; company: string; location: string; remoteType: string; salaryMin: string; publishedDays: string; sort: string; view: View; page: string };
const initial: Filters = { q: '', score: '', provider: '', company: '', location: '', remoteType: '', salaryMin: '', publishedDays: '', sort: 'score', view: 'active', page: '1' };
const views: { id: View; label: string }[] = [{ id: 'active', label: 'Open' }, { id: 'saved', label: 'Saved' }, { id: 'dismissed', label: 'Dismissed' }, { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' }];

export default function JobsPage() {
  const [filters, setFilters] = useState<Filters>(initial); const [search, setSearch] = useState('');
  useEffect(() => { const params = new URLSearchParams(window.location.search); const next = { ...initial }; for (const key of Object.keys(initial) as (keyof Filters)[]) { const value = params.get(key); if (value) (next[key] as string) = value; } setFilters(next); setSearch(next.q); }, []);
  useEffect(() => { const timer = setTimeout(() => setFilters(current => current.q === search ? current : { ...current, q: search, page: '1' }), 350); return () => clearTimeout(timer); }, [search]);
  const query = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([key, value]) => value && !(key === 'page' && value === '1') && !(key === 'view' && value === 'active') && !(key === 'sort' && value === 'score'))).toString(), [filters]);
  const { data, error, loading, refresh } = useResource<{ jobs: Job[]; total: number; page: number; pageSize: number }>(`/api/jobs?${query}`);
  const [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  const update = (name: keyof Filters, value: string) => setFilters(current => ({ ...current, [name]: value, page: name === 'page' ? value : '1' }));
  async function act(job: Job, action: 'save' | 'dismiss' | 'restore') {
    setMessage(''); setFailed(false);
    try {
      if (action === 'save') await api(`/api/jobs/${job.id}/save`, { method: 'POST', body: '{}' });
      else await api(`/api/jobs/${job.id}/dismiss`, { method: 'POST', body: JSON.stringify({ dismissed: action === 'dismiss' }) });
      setMessage(action === 'save' ? `Saved “${job.title}”.` : action === 'dismiss' ? `Dismissed “${job.title}”. It will not be notified again.` : `Restored “${job.title}”.`); refresh();
    } catch (reason) { setFailed(true); setMessage(errorMessage(reason)); }
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasFilters = Boolean(filters.q || filters.score || filters.provider || filters.company || filters.location || filters.remoteType || filters.salaryMin || filters.publishedDays);
  return <>
    <PageHeading eyebrow="DISCOVERY" title="Opportunities worth a closer look." description="Real vacancies from your configured sources, ranked by a transparent score with the evidence behind it." />
    <ImportPanel onDone={refresh} />
    <Feedback message={message} error={failed} />
    <section className="panel">
      <div className="panel-body">
        <Tabs label="Job views" tabs={views} value={filters.view} onChange={view => update('view', view)} />
        <div className="filters-wide">
          <Field label="Search"><div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 10, top: 12 }} aria-hidden /><input style={{ paddingLeft: 32 }} value={search} onChange={event => setSearch(event.target.value)} placeholder="Title, employer or keyword" /></div></Field>
          <Field label="Minimum match"><select value={filters.score} onChange={event => update('score', event.target.value)}><option value="">Any</option><option value="80">Strong (80+)</option><option value="65">Good (65+)</option><option value="50">Possible (50+)</option></select></Field>
          <Field label="Source"><select value={filters.provider} onChange={event => update('provider', event.target.value)}><option value="">All sources</option>{['france_travail', 'greenhouse', 'lever', 'ashby', 'generic', 'manual'].map(value => <option value={value} key={value}>{humanize(value)}</option>)}</select></Field>
          <Field label="Sort by"><select value={filters.sort} onChange={event => update('sort', event.target.value)}><option value="score">Best match</option><option value="newest">Newest found</option><option value="published">Publication date</option><option value="freshness">Recently confirmed</option><option value="salary">Salary</option><option value="company">Employer</option></select></Field>
        </div>
        <div className="filters-wide second">
          <Field label="Employer"><input value={filters.company} onChange={event => update('company', event.target.value)} /></Field>
          <Field label="Location"><input value={filters.location} onChange={event => update('location', event.target.value)} placeholder="City or region" /></Field>
          <Field label="Work style"><select value={filters.remoteType} onChange={event => update('remoteType', event.target.value)}><option value="">Any</option><option value="REMOTE">Remote</option><option value="HYBRID">Hybrid</option><option value="ONSITE">On-site</option><option value="UNKNOWN">Not stated</option></select></Field>
          <Field label="Published within"><select value={filters.publishedDays} onChange={event => update('publishedDays', event.target.value)}><option value="">Any time</option><option value="1">24 hours</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></Field>
        </div>
        <div className="filters-wide second"><Field label="Minimum salary (€/year)"><input type="number" min="0" step="1000" value={filters.salaryMin} onChange={event => update('salaryMin', event.target.value)} /></Field>{hasFilters && <div><button className="button secondary" onClick={() => { setSearch(''); setFilters({ ...initial, view: filters.view }); }}><RotateCcw size={14} /> Clear filters</button></div>}</div>
      </div>
      <Feedback message={error} error />
      {loading ? <Loading /> : data?.jobs.length ? <div className="job-list">{data.jobs.map(job => <JobRow key={job.id} job={job} onAction={act} />)}</div> : <EmptyState title="No opportunities match" description={hasFilters ? 'Loosen a filter, or run a search to look for new vacancies.' : filters.view === 'active' ? 'Nothing has been found yet. Configure a source and run a search, or import a posting you found elsewhere.' : 'Nothing here yet.'} />}
      {data && data.total > data.pageSize && <div className="pagination"><span>{data.total} jobs · page {data.page} of {pages}</span><div className="actions" style={{ margin: 0 }}><button className="button secondary" disabled={data.page <= 1} onClick={() => update('page', String(data.page - 1))}>Previous</button><button className="button secondary" disabled={data.page >= pages} onClick={() => update('page', String(data.page + 1))}>Next</button></div></div>}
    </section>
  </>;
}

function JobRow({ job, onAction }: { job: Job; onAction: (job: Job, action: 'save' | 'dismiss' | 'restore') => void }) {
  const closed = job.status !== 'ACTIVE'; const details = job.matchDetails; const saved = job.application && !['NEW', 'REVIEWED'].includes(job.application.status);
  return <article className={`job-row ${job.dismissedAt || closed ? 'dim' : ''}`}>
    <Score score={job.rankScore} ai={job.matchScore !== null} />
    <div>
      <h3><Link className="job-title" style={{ maxWidth: 'none' }} href={`/jobs/${job.id}`}>{job.title}</Link></h3>
      <p>{job.companyName} · {job.location || 'Location not stated'} · {humanize(job.remoteType)} · {salary(job.salaryMin, job.salaryMax, job.salaryCurrency)}</p>
      <div className="job-meta"><SourceBadges job={job} /><JobState job={job} /><span className="table-secondary" style={{ margin: 0 }}>Published {date(job.publishedAt)} · found {ago(job.discoveredAt)} · confirmed {ago(job.lastSeenAt)}</span></div>
      {details && <p className="why">{details.blockers.length ? <strong>Blocked: {details.blockers[0]}. </strong> : null}{details.components.flatMap(item => item.evidence).slice(0, 2).join(' ')}{details.missingSkills.length > 0 && <> <em>Missing: {details.missingSkills.slice(0, 3).join(', ')}.</em></>}</p>}
    </div>
    <div className="job-row-actions">
      {job.dismissedAt ? <button className="button secondary" onClick={() => onAction(job, 'restore')}><RotateCcw size={14} /> Restore</button> : <>
        <button className="button secondary" onClick={() => onAction(job, 'save')} disabled={Boolean(saved)} aria-label={`${saved ? "Saved" : "Save"}: ${job.title}`}>{saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}{saved ? 'Saved' : 'Save'}</button>
        <button className="button secondary" onClick={() => onAction(job, 'dismiss')} aria-label={`Dismiss ${job.title}`}><EyeOff size={14} /> Dismiss</button></>}
      {!closed && <a className="button" href={job.applicationUrl || job.sourceUrl} target="_blank" rel="noopener noreferrer">Apply <ExternalLink size={14} /></a>}
    </div>
  </article>;
}

function ImportPanel({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'url' | 'manual'>('url'); const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false), [prefill, setPrefill] = useState('');
  async function importUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const url = String(new FormData(form).get('url') ?? ''); setBusy(true); setMessage(''); setFailed(false);
    try { const result = await api<{ imported: { title: string; duplicate: boolean }[] }>('/api/jobs/import-url', { method: 'POST', body: JSON.stringify({ url }) }); setMessage(`Imported ${result.imported.length} posting${result.imported.length === 1 ? '' : 's'}${result.imported.some(item => item.duplicate) ? ' (some were already known and were merged)' : ''}.`); form.reset(); onDone(); }
    catch (reason) { setFailed(true); setMessage(errorMessage(reason)); setPrefill(url); setMode('manual'); }
    finally { setBusy(false); }
  }
  async function importManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setMessage(''); setFailed(false);
    try { await api('/api/jobs', { method: 'POST', body: JSON.stringify({ title: data.get('title'), companyName: data.get('companyName'), location: data.get('location'), descriptionClean: data.get('descriptionClean'), sourceUrl: data.get('sourceUrl'), applicationUrl: data.get('applicationUrl') || undefined, remoteType: data.get('remoteType'), contractType: data.get('contractType') }) }); setMessage('Job imported, scored and de-duplicated.'); form.reset(); setPrefill(''); onDone(); }
    catch (reason) { setFailed(true); setMessage(errorMessage(reason)); } finally { setBusy(false); }
  }
  return <details className="panel" style={{ marginBottom: 18 }}>
    <summary className="panel-head" style={{ cursor: 'pointer' }}><h2><Plus size={15} /> Import a posting you found elsewhere</h2></summary>
    <div className="panel-body">
      <Tabs label="Import method" tabs={[{ id: 'url', label: 'From a career-page URL' }, { id: 'manual', label: 'Paste the text' }]} value={mode} onChange={setMode} />
      <Feedback message={message} error={failed} />
      {mode === 'url' ? <form onSubmit={importUrl} className="form-grid"><Field label="Career-page URL" hint="HTTPS only. Works for pages that publish structured JobPosting data and allow access in robots.txt. Platforms such as LinkedIn, Indeed, HelloWork, Apec or Welcome to the Jungle forbid automated retrieval, so paste those postings instead." className="wide"><input name="url" type="url" required placeholder="https://careers.example.com/jobs/123" /></Field><div className="form-actions"><button className="button" disabled={busy}><Link2 size={15} /> {busy ? 'Reading page…' : 'Import from URL'}</button></div></form>
        : <form onSubmit={importManual} className="form-grid" key={prefill}><Field label="Title"><input name="title" required /></Field><Field label="Company"><input name="companyName" required /></Field><Field label="Location"><input name="location" defaultValue="France" /></Field><Field label="Original posting URL" hint="Kept as your application link."><input name="sourceUrl" type="url" required defaultValue={prefill} /></Field><Field label="Application URL (optional)"><input name="applicationUrl" type="url" /></Field><Field label="Work style"><select name="remoteType" defaultValue="UNKNOWN"><option value="UNKNOWN">Not stated</option><option value="REMOTE">Remote</option><option value="HYBRID">Hybrid</option><option value="ONSITE">On-site</option></select></Field><Field label="Contract"><input name="contractType" defaultValue="UNKNOWN" /></Field><Field label="Job description" className="wide"><textarea name="descriptionClean" required rows={8} /></Field><div className="form-actions"><button className="button" disabled={busy}>{busy ? 'Importing…' : 'Import and score'}</button></div></form>}
    </div>
  </details>;
}
