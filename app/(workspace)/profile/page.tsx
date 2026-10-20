'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Download, Upload } from 'lucide-react';
import { Badge, Feedback, Field, Loading, PageHeading, Toggle } from '@/components/ui';
import { ago, api, errorMessage, lines, useResource } from '@/lib/client';
import type { CandidateData, Resume } from '@/lib/ui-types';

type Response = { profile: CandidateData; version: number; resumes: Resume[] };
const listFields: { key: keyof CandidateData; label: string; hint?: string }[] = [
  { key: 'languages', label: 'Languages', hint: 'e.g. French (native), English (professional). Used to flag postings that require other languages.' }, { key: 'targetRoles', label: 'Target roles', hint: 'Data Engineer, Ingénieur Data, …' }, { key: 'secondaryRoles', label: 'Secondary roles' },
  { key: 'targetIndustries', label: 'Target industries' }, { key: 'seniorityLevels', label: 'Seniority levels' }, { key: 'coreSkills', label: 'Core skills', hint: 'Skills you can prove. Only these are ever claimed in documents.' },
  { key: 'secondarySkills', label: 'Secondary skills' }, { key: 'tools', label: 'Tools' }, { key: 'technologies', label: 'Technologies' }, { key: 'certifications', label: 'Certifications' },
  { key: 'locations', label: 'Preferred locations', hint: 'Nancy, Metz, Luxembourg, Grand Est, Remote France, Remote Europe, …' }, { key: 'contractTypes', label: 'Contract types', hint: 'CDI, CDD, freelance, …' },
  { key: 'excludedCompanies', label: 'Excluded companies' }, { key: 'excludedIndustries', label: 'Excluded industries' }, { key: 'excludedTitles', label: 'Excluded titles' }, { key: 'excludedKeywords', label: 'Excluded keywords' },
  { key: 'achievements', label: 'Achievements', hint: 'Concrete, true statements. Generated letters may only reuse these.' }, { key: 'strengths', label: 'Strengths' }, { key: 'weaknesses', label: 'Weaknesses' }
];
const scalarFields: { key: 'preferredName' | 'location' | 'currentTitle' | 'workAuthorization' | 'careerSummary' | 'careerGoals' | 'desiredNextStep'; label: string }[] = [{ key: 'preferredName', label: 'Preferred name' }, { key: 'location', label: 'Location' }, { key: 'currentTitle', label: 'Current title' }, { key: 'workAuthorization', label: 'Work authorization' }, { key: 'careerSummary', label: 'Career summary' }, { key: 'careerGoals', label: 'Career goals' }, { key: 'desiredNextStep', label: 'Desired next step' }];
const status: Record<string, string> = { QUEUED: 'Reading your CV…', PENDING_REVIEW: 'Suggestions ready to review', AI_NOT_CONFIGURED: 'Stored. AI is not configured, so no suggestions were made; fill the profile yourself.', EXTRACTION_FAILED: 'Suggestions could not be generated' };

type Proposal = { id: string; label: string; kind: 'list' | 'scalar' | 'number'; add?: string[]; value?: string | number; current?: string | number; key: keyof CandidateData; preselected: boolean };
function proposals(current: CandidateData, suggestions: Partial<CandidateData>): Proposal[] {
  const output: Proposal[] = []; const known = (list: string[]) => new Set(list.map(item => item.trim().toLowerCase()));
  for (const field of listFields) {
    const proposed = (suggestions[field.key] as string[] | undefined) ?? []; const existing = known(current[field.key] as string[]); const add = proposed.filter(item => item && !existing.has(item.trim().toLowerCase()));
    if (add.length) output.push({ id: field.key, label: field.label, kind: 'list', add, key: field.key, preselected: true });
  }
  for (const field of scalarFields) { const proposed = suggestions[field.key]; if (typeof proposed === 'string' && proposed.trim() && proposed.trim() !== current[field.key].trim()) output.push({ id: field.key, label: field.label, kind: 'scalar', value: proposed.trim(), current: current[field.key], key: field.key, preselected: !current[field.key].trim() }); }
  if (suggestions.yearsExperience && suggestions.yearsExperience !== current.yearsExperience) output.push({ id: 'yearsExperience', label: 'Years of experience', kind: 'number', value: suggestions.yearsExperience, current: current.yearsExperience, key: 'yearsExperience', preselected: current.yearsExperience === 0 });
  return output;
}

export default function ProfilePage() {
  const [polling, setPolling] = useState(false);
  const resource = useResource<Response>('/api/profile', polling ? 4000 : 0);
  const [profile, setProfile] = useState<CandidateData | null>(null), [message, setMessage] = useState(''), [failed, setFailed] = useState(false), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [review, setReview] = useState<Resume | null>(null);
  const loadedVersion = useRef<number | null>(null);
  // Load the server copy once per saved version; polling or refreshes must never overwrite what the owner is typing.
  useEffect(() => { if (resource.data && loadedVersion.current !== resource.data.version) { loadedVersion.current = resource.data.version; setProfile(resource.data.profile); setDirty(false); } }, [resource.data]);
  useEffect(() => { setPolling(Boolean(resource.data?.resumes.some(resume => resume.extractionStatus === 'QUEUED'))); }, [resource.data]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  const notify = (text: string, isError = false) => { setMessage(text); setFailed(isError); };
  const set = <K extends keyof CandidateData>(key: K, value: CandidateData[K]) => { setProfile(current => current ? { ...current, [key]: value } : current); setDirty(true); };
  async function save(event: FormEvent) {
    event.preventDefault(); if (!profile) return; setBusy(true);
    try { await api('/api/profile', { method: 'PUT', body: JSON.stringify(profile) }); loadedVersion.current = null; notify('Profile saved. Stored jobs are being re-scored against it.'); setDirty(false); resource.refresh(); }
    catch (reason) { notify(errorMessage(reason), true); } finally { setBusy(false); }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; setBusy(true);
    try { const result = await api<{ extractionStatus: string }>('/api/resume/upload', { method: 'POST', body: new FormData(form) }); notify(result.extractionStatus === 'QUEUED' ? 'Resume stored. Suggestions are being prepared for your review.' : 'Resume stored. AI is not configured, so please fill in your profile below.'); form.reset(); resource.refresh(); }
    catch (reason) { notify(errorMessage(reason), true); } finally { setBusy(false); }
  }
  if (resource.loading || !profile) return <Loading />;
  return <>
    <PageHeading eyebrow="YOUR EVIDENCE" title="A profile grounded in what you have done." description={`Profile version ${resource.data?.version ?? 0}. Every score and document is built only from this reviewed profile. Suggestions from your CV never change it until you approve them.`} />
    <Feedback message={message || resource.error} error={failed || Boolean(resource.error)} />
    <section className="panel" style={{ marginBottom: 18 }}><div className="panel-head"><h2>Master resume</h2></div><div className="panel-body">
      <form onSubmit={upload} className="form-grid"><Field label="PDF, DOCX, Markdown or text" hint="Maximum 5 MB. The original file is kept unchanged and private."><input type="file" name="file" accept=".pdf,.docx,.md,.txt,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required /></Field><div className="form-actions" style={{ alignSelf: 'end', marginTop: 0 }}><button className="button" disabled={busy}><Upload size={15} /> Upload</button></div></form>
      {resource.data?.resumes.map(resume => <div className="job-card" key={resume.id}><div className="job-card-top"><div><strong>{resume.fileName}</strong><span className="table-secondary">{ago(resume.createdAt)} · {status[resume.extractionStatus ?? ''] ?? resume.extractionStatus}</span></div>
        <div className="actions" style={{ margin: 0 }}><a className="button secondary" href={`/api/resume/${resume.id}/download`}><Download size={14} /> Original</a>{resume.suggestions && <button className="button secondary" onClick={() => setReview(review?.id === resume.id ? null : resume)}>{review?.id === resume.id ? 'Close review' : 'Review suggestions'}</button>}</div></div>
        {review?.id === resume.id && resume.suggestions && <SuggestionReview current={profile} suggestions={resume.suggestions} onApply={apply => { setProfile(apply); setDirty(true); setReview(null); notify('Selected suggestions were copied into the form below. Check them, then choose “Save reviewed profile”.'); }} onCancel={() => setReview(null)} />}</div>)}
    </div></section>
    <form onSubmit={save} className="section-stack">
      <section className="panel"><div className="panel-head"><h2>Personal and career direction</h2></div><div className="panel-body form-grid">
        <Field label="Preferred name"><input value={profile.preferredName} onChange={e => set('preferredName', e.target.value)} /></Field><Field label="Home location" hint="Used to judge cross-border commutes."><input value={profile.location} onChange={e => set('location', e.target.value)} placeholder="Metz" /></Field>
        <Field label="Current title"><input value={profile.currentTitle} onChange={e => set('currentTitle', e.target.value)} /></Field><Field label="Years of experience"><input type="number" min="0" max="80" value={profile.yearsExperience} onChange={e => set('yearsExperience', Number(e.target.value))} /></Field>
        <Field label="Work authorization" className="wide" hint="e.g. EU citizen, or the permit you hold. Postings that mention authorization are flagged for you to verify."><input value={profile.workAuthorization} onChange={e => set('workAuthorization', e.target.value)} /></Field>
        {listFields.map(field => <Field key={String(field.key)} label={field.label} hint={field.hint ?? 'One per line or comma separated'}><textarea value={(profile[field.key] as string[]).join('\n')} onChange={e => set(field.key, lines(e.target.value) as never)} /></Field>)}
      </div></section>
      <section className="panel"><div className="panel-head"><h2>Work style and compensation</h2></div><div className="panel-body form-grid">
        <Toggle label="Remote" checked={profile.remote} onChange={value => set('remote', value)} /><Toggle label="Hybrid" checked={profile.hybrid} onChange={value => set('hybrid', value)} /><Toggle label="On-site" checked={profile.onsite} onChange={value => set('onsite', value)} /><Toggle label="Open to relocation" checked={profile.relocation} onChange={value => set('relocation', value)} />
        <Field label="Maximum commute (km)" hint="Default 70 km. Fully remote roles ignore it."><input type="number" min="0" value={profile.maxCommuteKm ?? ''} onChange={e => set('maxCommuteKm', e.target.value ? Number(e.target.value) : null)} /></Field><Field label="Travel tolerance"><input value={profile.travelTolerance} onChange={e => set('travelTolerance', e.target.value)} /></Field>
        <Field label="Minimum salary (€/year)" hint="Jobs that state a maximum below this are blocked."><input type="number" min="0" value={profile.minimumSalary ?? ''} onChange={e => set('minimumSalary', e.target.value ? Number(e.target.value) : null)} /></Field><Field label="Preferred salary (€/year)"><input type="number" min="0" value={profile.preferredSalary ?? ''} onChange={e => set('preferredSalary', e.target.value ? Number(e.target.value) : null)} /></Field>
      </div></section>
      <section className="panel"><div className="panel-head"><h2>Recruiter context</h2></div><div className="panel-body form-grid"><Field label="Career summary" className="wide"><textarea value={profile.careerSummary} onChange={e => set('careerSummary', e.target.value)} /></Field><Field label="Career goals"><textarea value={profile.careerGoals} onChange={e => set('careerGoals', e.target.value)} /></Field><Field label="Desired next step"><textarea value={profile.desiredNextStep} onChange={e => set('desiredNextStep', e.target.value)} /></Field></div></section>
      <div className="form-actions" style={{ position: 'sticky', bottom: 0, background: 'var(--bg)', padding: '12px 0', margin: 0 }}>{dirty && <Badge tone="amber">Unsaved changes</Badge>}<button className="button" disabled={busy}>{busy ? 'Saving…' : 'Save reviewed profile'}</button></div>
    </form>
  </>;
}

function SuggestionReview({ current, suggestions, onApply, onCancel }: { current: CandidateData; suggestions: Partial<CandidateData>; onApply: (next: CandidateData) => void; onCancel: () => void }) {
  const items = useMemo(() => proposals(current, suggestions), [current, suggestions]);
  const [picked, setPicked] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map(item => [item.id, item.preselected])));
  function apply() {
    const next = { ...current } as Record<string, unknown>;
    for (const item of items) { if (!picked[item.id]) continue; next[item.key] = item.kind === 'list' ? [...(current[item.key] as string[]), ...(item.add ?? [])] : item.value; }
    onApply(next as CandidateData);
  }
  if (!items.length) return <p className="table-secondary">Nothing new: your profile already contains everything that was found in this CV.</p>;
  return <div style={{ marginTop: 12 }}>
    <p className="table-secondary">Found in your CV. Tick only what is accurate; nothing is saved until you press “Save reviewed profile”. Existing entries are never removed.</p>
    {items.map(item => <div className="suggestion" key={item.id}><label><input type="checkbox" checked={Boolean(picked[item.id])} onChange={() => setPicked(current => ({ ...current, [item.id]: !current[item.id] }))} /><span>{item.kind === 'list' ? `Add to ${item.label}` : `Set ${item.label}`}</span></label>
      {item.kind === 'list' ? <ul>{item.add!.map(value => <li key={value}>{value}</li>)}</ul> : <ul><li>{String(item.value)}</li>{item.current ? <li>Currently: {String(item.current)}</li> : null}</ul>}</div>)}
    <div className="actions"><button type="button" className="button" onClick={apply}>Copy selected into the form</button><button type="button" className="button secondary" onClick={onCancel}>Cancel</button></div>
  </div>;
}
