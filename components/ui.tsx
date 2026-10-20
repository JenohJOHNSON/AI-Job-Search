'use client';

import Link from 'next/link';
import { ArrowUpRight, BriefcaseBusiness, CircleAlert, CircleCheck, CircleHelp, LoaderCircle, Search, Sparkles, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { ago, date, humanize, providerName, salary } from '@/lib/client';
import { labelFor, matchLabelText, type Job, type MatchComponent, type MatchDetails } from '@/lib/ui-types';

export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}
export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'green' | 'blue' | 'amber' | 'red'; title?: string }) { return <span className={`badge badge-${tone}`} title={title}>{children}</span>; }

/** Transparent 0–100 score. The label is derived from the number, never invented separately. */
export function Score({ score, compact = false, ai = false }: { score: number | null; compact?: boolean; ai?: boolean }) {
  const label = labelFor(score); const tone = label === 'STRONG' ? 'green' : label === 'GOOD' ? 'blue' : label === 'POSSIBLE' ? 'amber' : 'neutral';
  return <div className={`score score-${tone} ${compact ? 'score-compact' : ''}`} title={ai ? 'Refined by AI analysis' : 'Rule-based score from your reviewed profile'}><span className="score-value">{score === null ? '—' : score}<span className="sr-only"> out of 100</span></span><span className="score-label">{label ? matchLabelText[label] : 'Not scored'}{ai && ' · AI'}</span></div>;
}
export function Feedback({ message, error = false }: { message: string; error?: boolean }) {
  if (!message) return null;
  return <div role={error ? 'alert' : 'status'} className={`feedback ${error ? 'feedback-error' : ''}`}><CircleAlert size={17} /><span>{message}</span></div>;
}
export function Loading() { return <div className="loading" role="status"><LoaderCircle size={22} className="spin" /><span>Loading your workspace…</span></div>; }
export function EmptyState({ title, description, action, icon = 'search' }: { title: string; description: string; action?: ReactNode; icon?: 'search' | 'job' | 'sparkles' }) {
  const Icon = icon === 'job' ? BriefcaseBusiness : icon === 'sparkles' ? Sparkles : Search;
  return <div className="empty-state"><div className="empty-icon"><Icon size={26} strokeWidth={1.5} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) { return <label className={`field ${className}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Toggle({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="toggle-row"><div><span>{label}</span>{description && <small>{description}</small>}</div><input className="switch" type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} /></label>;
}
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (value: T) => void; label: string }) {
  return <div className="tabs" role="tablist" aria-label={label}>{tabs.map(tab => <button key={tab.id} role="tab" aria-selected={tab.id === value} className={`tab ${tab.id === value ? 'active' : ''}`} onClick={() => onChange(tab.id)}>{tab.label}{tab.count !== undefined && <span>{tab.count}</span>}</button>)}</div>;
}
export function Bar({ value, max, label, tone }: { value: number; max: number; label: string; tone?: 'green' | 'amber' | 'red' }) {
  const ratio = max ? Math.max(0, Math.min(1, value / max)) : 0; const color = tone ?? (ratio >= 0.7 ? 'green' : ratio >= 0.4 ? 'amber' : 'red');
  return <div className="bar" role="progressbar" aria-label={label} aria-valuenow={Math.round(value * 10) / 10} aria-valuemin={0} aria-valuemax={max}><span className={`bar-fill bar-${color}`} style={{ width: `${ratio * 100}%` }} /></div>;
}
export function SourceBadges({ job }: { job: Pick<Job, 'sources'> }) {
  const names = [...new Set((job.sources ?? []).filter(source => !source.removedAt).map(source => providerName[source.provider] ?? humanize(source.provider)))];
  return <>{names.length ? names.map(name => <Badge key={name}>{name}</Badge>) : <Badge>Manual</Badge>}</>;
}
export function JobState({ job }: { job: Pick<Job, 'status' | 'dismissedAt' | 'application'> }) {
  if (job.status === 'REMOVED' || job.status === 'EXPIRED') return <Badge tone="red" title="The employer's listing is gone or past its validity date">{job.status === 'EXPIRED' ? 'Expired' : 'No longer listed'}</Badge>;
  if (job.dismissedAt) return <Badge>Dismissed</Badge>;
  if (job.application) return <Badge tone={['APPLIED', 'INTERVIEW', 'OFFER'].includes(job.application.status) ? 'green' : 'blue'}>{humanize(job.application.status)}</Badge>;
  return null;
}

export function JobTable({ jobs }: { jobs: Job[] }) {
  return <div className="table-scroll"><table className="job-table"><thead><tr><th>Match</th><th>Opportunity</th><th>Location / work style</th><th>Salary</th><th>Source</th><th>Dates</th><th>Status</th><th><span className="sr-only">View</span></th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td><Score score={job.rankScore} compact ai={job.matchScore !== null} /></td><td><Link className="job-title" href={`/jobs/${job.id}`}>{job.title}</Link><span className="table-secondary">{job.companyName}</span></td><td>{job.location || 'Not specified'}<span className="table-secondary">{humanize(job.remoteType)}</span></td><td className="nowrap">{salary(job.salaryMin, job.salaryMax, job.salaryCurrency)}<span className="table-secondary">{humanize(job.contractType)}</span></td><td><div className="pill-list"><SourceBadges job={job} /></div></td><td className="nowrap"><span title="Published date">{date(job.publishedAt)}</span><span className="table-secondary">Found {ago(job.discoveredAt)}</span></td><td><JobState job={job} /></td><td><Link className="icon-button" href={`/jobs/${job.id}`} aria-label={`View ${job.title}`}><ArrowUpRight size={17} /></Link></td></tr>)}</tbody></table></div>;
}

const componentTone = (item: MatchComponent) => item.max ? item.score / item.max : 0;
/** Evidence-first explanation: what supports the match, what is missing, and what is simply unknown. Nothing here is inferred beyond the stored profile. */
export function MatchBreakdown({ details }: { details: MatchDetails }) {
  return <div className="breakdown">
    {details.blockers.length > 0 && <div className="feedback feedback-error" role="alert"><TriangleAlert size={17} /><span><strong>Hard blockers (score capped at 35):</strong> {details.blockers.join(' · ')}</span></div>}
    <div className="breakdown-grid">{details.components.map(item => <section key={item.key} className="breakdown-item">
      <div className="dimension-head"><span>{item.label}</span><strong>{Math.round(item.score * 10) / 10}/{item.max}</strong></div><Bar value={item.score} max={item.max} label={`${item.label} score`} />
      <ul className="evidence-list">{item.evidence.map(text => <li key={text} className="ev-ok"><CircleCheck size={14} /><span>{text}</span></li>)}{item.gaps.map(text => <li key={text} className="ev-gap"><TriangleAlert size={14} /><span>{text}</span></li>)}{item.uncertain.map(text => <li key={text} className="ev-unknown"><CircleHelp size={14} /><span>{text}</span></li>)}</ul>
      {componentTone(item) === 0 && !item.evidence.length && !item.gaps.length && !item.uncertain.length && <p className="table-secondary">No information.</p>}
    </section>)}</div>
    <div className="grid two" style={{ marginTop: 14 }}>
      <div><h3>Skills supported by your profile</h3><div className="pill-list">{details.matchedSkills.length ? details.matchedSkills.map(item => <span className="pill pill-ok" key={item.skill} title={item.evidence}>{item.skill}<small> · {item.evidence}</small></span>) : <span className="table-secondary">None found.</span>}</div></div>
      <div><h3>Required but not evidenced</h3><div className="pill-list">{details.missingSkills.length ? details.missingSkills.map(item => <span className="pill pill-gap" key={item}>{item}</span>) : <span className="table-secondary">No gaps detected.</span>}</div>{details.transferableSkills.length > 0 && <><h3 style={{ marginTop: 14 }}>Transferable</h3><ul className="evidence-list">{details.transferableSkills.map(text => <li key={text} className="ev-unknown"><CircleHelp size={14} /><span>{text}</span></li>)}</ul></>}</div>
    </div>
    <p className="table-secondary">Rule-based engine v{details.engineVersion} · confidence {Math.round(details.confidence * 100)}%. Skills are only credited when they appear in your reviewed profile.</p>
  </div>;
}
