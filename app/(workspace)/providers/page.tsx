'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ExternalLink, Plug, Plus, Save } from 'lucide-react';
import { Badge, EmptyState, Feedback, Field, Loading, PageHeading, Toggle } from '@/components/ui';
import { ago, api, errorMessage, humanize, lines, useResource } from '@/lib/client';
import type { Provider } from '@/lib/ui-types';

const help: Record<string, { label: string; example: string; where: string }> = {
  greenhouse: { label: 'Greenhouse board names', example: 'doctolib', where: 'boards.greenhouse.io/<name>' },
  lever: { label: 'Lever site names', example: 'scaleway', where: 'jobs.lever.co/<name>' },
  ashby: { label: 'Ashby board names', example: 'alan', where: 'jobs.ashbyhq.com/<name>' }
};
// Boards that answered with open vacancies when this list was last checked (2026-10-18). Employers change ATS vendors, so always run the connection check.
const suggestions: Record<string, { slug: string; name: string }[]> = {
  greenhouse: [{ slug: 'doctolib', name: 'Doctolib' }, { slug: 'dataiku', name: 'Dataiku' }, { slug: 'mirakl', name: 'Mirakl' }, { slug: 'algolia', name: 'Algolia' }, { slug: 'datadog', name: 'Datadog' }],
  lever: [{ slug: 'scaleway', name: 'Scaleway' }, { slug: 'swile', name: 'Swile' }, { slug: 'qonto', name: 'Qonto' }, { slug: 'agicap', name: 'Agicap' }],
  ashby: [{ slug: 'alan', name: 'Alan' }, { slug: 'pennylane', name: 'Pennylane' }, { slug: 'ledger', name: 'Ledger' }]
};
const tone = (status: string) => status === 'HEALTHY' ? 'green' : status === 'FAILED' ? 'red' : status === 'DISABLED' ? 'neutral' : 'amber';

export default function ProvidersPage() {
  const { data, error, loading, refresh } = useResource<{ providers: Provider[] }>('/api/providers');
  const [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  const supported = data?.providers.filter(provider => provider.supported) ?? []; const unsupported = data?.providers.filter(provider => !provider.supported) ?? [];
  return <>
    <PageHeading eyebrow="SOURCES" title="Independent sources, honest health." description="Each source runs on its own: one failing never stops the others. Only official APIs and public employer boards are used." />
    <Feedback message={message || error} error={failed || Boolean(error)} />
    {loading ? <Loading /> : !supported.length ? <section className="panel"><EmptyState title="The source registry is empty" description="Sign in again to initialise the sources." /></section> :
      <section className="panel">{supported.map(provider => <ProviderCard key={provider.id} provider={provider} onChanged={refresh} notify={(text, isError) => { setMessage(text); setFailed(isError); }} />)}</section>}
    <section className="panel" style={{ marginTop: 18 }}><div className="panel-head"><h2>No automatic access</h2></div><div className="panel-body">
      <p className="table-secondary" style={{ marginTop: 0 }}>These platforms do not offer a permitted public integration, or forbid automated retrieval. Élan never logs in, bypasses CAPTCHAs or rate limits, or scrapes them. Open the posting yourself and use <Link href="/jobs"><strong>Import a posting</strong></Link> to track and score it.</p>
      <div className="pill-list">{unsupported.map(provider => <span className="pill" key={provider.id}>{provider.name}</span>)}</div>
      <p className="table-secondary">Luxembourg: France Travail covers France only. For cross-border roles, follow Luxembourg employers that publish a Greenhouse, Lever or Ashby board or a career page with structured data, or import postings manually.</p>
    </div></section>
  </>;
}

function ProviderCard({ provider, onChanged, notify }: { provider: Provider; onChanged: () => void; notify: (message: string, error: boolean) => void }) {
  const [enabled, setEnabled] = useState(provider.enabled), [boards, setBoards] = useState((provider.config.boards ?? []).join('\n')), [urls, setUrls] = useState((provider.config.urls ?? []).join('\n')), [hosts, setHosts] = useState((provider.config.allowedHosts ?? []).join('\n')), [maxJobs, setMaxJobs] = useState(provider.maxJobs), [busy, setBusy] = useState(''), [check, setCheck] = useState<{ status: string; detail: string } | null>(null);
  const tip = help[provider.id]; const isBoard = Boolean(tip); const isGeneric = provider.id === 'generic'; const needsCredentials = provider.id === 'france_travail' && provider.credentialsConfigured === false;
  const addSuggestion = (slug: string) => setBoards(current => lines(current).some(item => item.toLowerCase() === slug) ? current : [...lines(current), slug].join('\n'));
  function body() {
    const derivedHosts = lines(hosts).length ? lines(hosts) : lines(urls).flatMap(url => { try { return [new URL(url).hostname]; } catch { return []; } });
    return { enabled, maxJobs: Number(maxJobs), ...(isBoard ? { config: { boards: lines(boards) } } : isGeneric ? { config: { urls: lines(urls), allowedHosts: derivedHosts } } : {}) };
  }
  async function save() {
    setBusy('save');
    try { await api(`/api/providers/${provider.id}`, { method: 'PATCH', body: JSON.stringify(body()) }); if (isGeneric && !lines(hosts).length) setHosts(lines(urls).flatMap(url => { try { return [new URL(url).hostname]; } catch { return []; } }).join('\n')); notify(`${provider.name} saved.`, false); onChanged(); }
    catch (reason) { notify(errorMessage(reason), true); } finally { setBusy(''); }
  }
  async function test() {
    setBusy('check'); setCheck(null);
    try { await api(`/api/providers/${provider.id}`, { method: 'PATCH', body: JSON.stringify(body()) }); setCheck(await api<{ status: string; detail: string }>(`/api/providers/${provider.id}/check`, { method: 'POST', body: '{}' })); onChanged(); }
    catch (reason) { setCheck({ status: 'FAILED', detail: errorMessage(reason) }); } finally { setBusy(''); }
  }
  return <div className="provider-card">
    <div className="provider-card-head"><div><h3>{provider.name}</h3><p>{provider.description}</p><p>{provider.message || 'No health report yet.'}{provider.lastSuccessAt && ` · last success ${ago(provider.lastSuccessAt)}`}</p></div>
      <div style={{ display: 'grid', gap: 10, justifyItems: 'end' }}><Badge tone={tone(provider.status)}>{humanize(provider.status)}</Badge><Toggle label="Enabled" checked={enabled} onChange={setEnabled} /></div></div>
    {needsCredentials && <div className="feedback feedback-error" role="status"><span>France Travail needs <strong>FRANCE_TRAVAIL_CLIENT_ID</strong> and <strong>FRANCE_TRAVAIL_CLIENT_SECRET</strong> in the environment. Create an application on <a href="https://francetravail.io" target="_blank" rel="noopener noreferrer">francetravail.io <ExternalLink size={12} /></a> and subscribe it to “Offres d’emploi v2”.</span></div>}
    {provider.id === 'france_travail' && <p className="table-secondary">Searches use your search-profile titles (French and English variants) and the départements of your preferred places, such as Meurthe-et-Moselle (Nancy) and Moselle (Metz).</p>}
    {isBoard && tip && <div className="provider-config"><Field label={tip.label} hint={`One per line. You can paste a board URL; the name is the part after ${tip.where}. Example: ${tip.example}`}><textarea value={boards} onChange={event => setBoards(event.target.value)} rows={5} /></Field>
      <div className="field"><span>Starter suggestions</span><div className="chip-row">{suggestions[provider.id]?.map(item => <button type="button" key={item.slug} className="pill" onClick={() => addSuggestion(item.slug)} aria-label={`Add ${item.name}`}><Plus size={11} /> {item.name}</button>)}</div><small>Public boards that listed open vacancies on 2026-10-18. Most are Paris-based tech employers; few Nancy, Metz or Luxembourg companies publish public boards. Run the connection check after adding.</small></div></div>}
    {isGeneric && <div className="provider-config"><Field label="Career page URLs" hint="HTTPS pages that publish schema.org JobPosting data and allow access in robots.txt."><textarea value={urls} onChange={event => setUrls(event.target.value)} rows={4} placeholder="https://careers.example.com/jobs" /></Field><Field label="Allowed hosts" hint="Filled from your URLs when left empty. Requests to any other host are refused."><textarea value={hosts} onChange={event => setHosts(event.target.value)} rows={4} /></Field></div>}
    <div className="provider-actions">
      <Field label="Max stored jobs per run"><input type="number" min={1} max={500} value={maxJobs} onChange={event => setMaxJobs(Number(event.target.value))} style={{ width: 120 }} /></Field>
      <button className="button secondary" disabled={Boolean(busy)} onClick={test}><Plug size={15} /> {busy === 'check' ? 'Checking…' : 'Check connection'}</button>
      <button className="button" disabled={Boolean(busy)} onClick={save}><Save size={15} /> {busy === 'save' ? 'Saving…' : 'Save'}</button>
    </div>
    {check && <div className={`feedback ${check.status === 'FAILED' ? 'feedback-error' : ''}`} role="status"><span><strong>{humanize(check.status)}:</strong> {check.detail}</span></div>}
  </div>;
}
