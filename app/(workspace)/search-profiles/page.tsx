'use client';
import { useState, type FormEvent } from 'react';
import { Sparkles, Trash2 } from 'lucide-react';
import { Badge, EmptyState, Feedback, Field, Loading, PageHeading, Toggle } from '@/components/ui';
import { api, errorMessage, humanize, lines, useResource } from '@/lib/client';
import type { SearchProfile } from '@/lib/ui-types';

type Draft = Omit<SearchProfile, 'id'>;
const blank: Draft = { name: '', enabled: true, targetTitles: [], alternativeTitles: [], keywords: [], excludedKeywords: [], locations: [], remotePreferences: ['remote', 'hybrid', 'onsite'], salaryMin: null, contractTypes: ['CDI'], seniority: [], datePostedWindow: 14, providers: [], minimumMatchScore: 45 };
const regions = ['Nancy', 'Metz', 'Grand Est', 'Luxembourg', 'Remote France', 'Remote Europe'];
// Starting points only: applying one fills the form, you review and save it. Nothing is created until you press Save.
const templates: { id: string; label: string; draft: Partial<Draft> }[] = [
  { id: 'data', label: 'Data & integration', draft: { name: 'Data & integration', targetTitles: ['Data Engineer', 'Ingénieur Data', 'Développeur ETL', 'Développeur SSIS', 'Développeur Talend', 'SQL Server Developer', 'Data Integration Engineer', 'Azure Data Engineer'], alternativeTitles: ['Ingénieur Big Data', 'Consultant ETL', 'Analytics Engineer'], keywords: ['SQL Server', 'SSIS', 'Talend', 'ETL', 'Azure', 'Python'], locations: regions } },
  { id: 'devops', label: 'DevOps & C++', draft: { name: 'DevOps & C++', targetTitles: ['DevOps Engineer', 'Ingénieur DevOps', 'C++ Developer', 'Développeur C++'], alternativeTitles: ['Ingénieur Cloud', 'Site Reliability Engineer', 'Ingénieur logiciel C++'], keywords: ['Azure', 'Docker', 'Kubernetes', 'CI/CD', 'C++', 'Linux'], locations: regions } },
  { id: 'analyst', label: 'Analyst roles', draft: { name: 'Analyst roles', targetTitles: ['Data Analyst', 'Analyste de données', 'Business Analyst', 'Analyste métier', 'Product Definition Analyst'], alternativeTitles: ['Analyste BI', 'Analyste fonctionnel', 'Product Analyst'], keywords: ['SQL', 'Power BI', 'Excel', 'reporting'], locations: regions } }
];
const providerOptions = ['france_travail', 'greenhouse', 'lever', 'ashby', 'generic'];
const windows = [1, 3, 7, 14, 30];

export default function SearchProfilesPage() {
  const { data, error, loading, refresh } = useResource<{ profiles: SearchProfile[] }>('/api/search/profiles');
  const [message, setMessage] = useState(''), [failed, setFailed] = useState(false), [editing, setEditing] = useState<string | null>(null), [draft, setDraft] = useState<Draft>(blank), [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const notify = (text: string, isError = false) => { setMessage(text); setFailed(isError); };
  function edit(profile: SearchProfile) { const { id, ...rest } = profile; setEditing(id); setDraft(rest); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function reset() { setEditing(null); setDraft(blank); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); notify('');
    try { await api(editing ? `/api/search/profiles/${editing}` : '/api/search/profiles', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(draft) }); notify(editing ? 'Search profile updated. Stored jobs are being re-scored.' : 'Search profile created. Run a search to use it.'); reset(); refresh(); }
    catch (reason) { notify(errorMessage(reason), true); } finally { setBusy(false); }
  }
  async function toggle(profile: SearchProfile) { try { const { id, ...rest } = profile; await api(`/api/search/profiles/${id}`, { method: 'PUT', body: JSON.stringify({ ...rest, enabled: !profile.enabled }) }); refresh(); } catch (reason) { notify(errorMessage(reason), true); } }
  async function remove(profile: SearchProfile) { if (!window.confirm(`Delete “${profile.name}”? Jobs already found are kept.`)) return; try { await api(`/api/search/profiles/${profile.id}`, { method: 'DELETE' }); notify('Search profile deleted.'); if (editing === profile.id) reset(); refresh(); } catch (reason) { notify(errorMessage(reason), true); } }
  const flip = (key: 'remotePreferences' | 'providers', value: string) => set(key, draft[key].includes(value) ? draft[key].filter(item => item !== value) : [...draft[key], value]);
  return <>
    <PageHeading eyebrow="SEARCH INTENT" title="A few focused searches, reused well." description="Titles, places and filters for what you want to find. French and English variants are searched automatically, and every vacancy is scored against your reviewed profile." />
    <Feedback message={message || error} error={failed || Boolean(error)} />
    <section className="panel"><div className="panel-head"><h2>{editing ? `Edit “${draft.name}”` : 'Create a search profile'}</h2>{!editing && <div className="chip-row">{templates.map(template => <button key={template.id} type="button" className="pill" onClick={() => setDraft({ ...blank, ...template.draft })}><Sparkles size={11} /> {template.label}</button>)}</div>}</div>
      <form className="panel-body" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Name"><input value={draft.name} onChange={event => set('name', event.target.value)} required maxLength={120} /></Field>
          <Field label="Published within" hint="Applies to search-based sources such as France Travail. Employer boards are always read in full."><select value={draft.datePostedWindow} onChange={event => set('datePostedWindow', Number(event.target.value))}>{windows.map(days => <option value={days} key={days}>{days} {days === 1 ? 'day' : 'days'}</option>)}</select></Field>
          <Field label="Target job titles" hint="One per line. French and English."><textarea value={draft.targetTitles.join('\n')} onChange={event => set('targetTitles', lines(event.target.value))} required rows={6} /></Field>
          <Field label="Related titles" hint="Looser variants worth searching."><textarea value={draft.alternativeTitles.join('\n')} onChange={event => set('alternativeTitles', lines(event.target.value))} rows={6} /></Field>
          <Field label="Locations" hint="Cities, regions, “Remote France”, “Remote Europe”. Luxembourg counts as cross-border from Metz."><textarea value={draft.locations.join('\n')} onChange={event => set('locations', lines(event.target.value))} rows={5} /></Field>
          <Field label="Keywords (interest signals)" hint="Technologies you want to see; they nudge the score slightly."><textarea value={draft.keywords.join('\n')} onChange={event => set('keywords', lines(event.target.value))} rows={5} /></Field>
          <Field label="Exclude if the posting mentions" hint="A match is blocked when any of these appear."><textarea value={draft.excludedKeywords.join('\n')} onChange={event => set('excludedKeywords', lines(event.target.value))} rows={3} /></Field>
          <div className="section-stack">
            <Field label="Contract types" hint="Comma separated, e.g. CDI, CDD, freelance"><input value={draft.contractTypes.join(', ')} onChange={event => set('contractTypes', lines(event.target.value))} /></Field>
            <Field label="Minimum salary (€/year)"><input type="number" min={0} step={1000} value={draft.salaryMin ?? ''} onChange={event => set('salaryMin', event.target.value ? Number(event.target.value) : null)} /></Field>
          </div>
          <div className="field"><span>Work styles</span>{['remote', 'hybrid', 'onsite'].map(style => <label key={style} className="toggle-row"><span>{humanize(style)}</span><input className="switch" type="checkbox" role="switch" checked={draft.remotePreferences.includes(style)} onChange={() => flip('remotePreferences', style)} /></label>)}</div>
          <div className="field"><span>Sources to use</span><small>None selected means every enabled source.</small>{providerOptions.map(id => <label key={id} className="toggle-row"><span>{humanize(id)}</span><input className="switch" type="checkbox" role="switch" checked={draft.providers.includes(id)} onChange={() => flip('providers', id)} /></label>)}</div>
          <Field label={`Store jobs scoring at least ${draft.minimumMatchScore}`} hint="Lower shows more, weaker matches. Hard blockers always stay out."><div className="range-row"><input type="range" min={0} max={90} step={5} value={draft.minimumMatchScore} onChange={event => set('minimumMatchScore', Number(event.target.value))} /><output>{draft.minimumMatchScore}</output></div></Field>
          <Toggle label="Active" description="Inactive profiles are kept but not searched." checked={draft.enabled} onChange={value => set('enabled', value)} />
        </div>
        <div className="form-actions">{(editing || draft.name) && <button type="button" className="button secondary" onClick={reset}>Cancel</button>}<button className="button" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create profile'}</button></div>
      </form></section>
    <section className="panel" style={{ marginTop: 18 }}><div className="panel-head"><h2>Your search profiles</h2></div>
      {loading ? <Loading /> : !data?.profiles.length ? <EmptyState title="No search profiles yet" description="Start from a template above, adjust it, and save." /> : data.profiles.map(profile => <div className="provider-row" key={profile.id}><div><h3>{profile.name} <Badge tone={profile.enabled ? 'green' : 'neutral'}>{profile.enabled ? 'Active' : 'Inactive'}</Badge></h3><p>{profile.targetTitles.slice(0, 6).join(', ')}{profile.targetTitles.length > 6 ? '…' : ''}</p><p>{profile.locations.join(' · ') || 'Anywhere'} · last {profile.datePostedWindow} days · min score {profile.minimumMatchScore}</p></div>
        <div className="actions" style={{ marginTop: 0 }}><button className="button secondary" onClick={() => toggle(profile)}>{profile.enabled ? 'Deactivate' : 'Activate'}</button><button className="button secondary" onClick={() => edit(profile)}>Edit</button><button className="button secondary" onClick={() => remove(profile)} aria-label={`Delete ${profile.name}`}><Trash2 size={14} /></button></div></div>)}
    </section>
  </>;
}
