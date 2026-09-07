'use client';

import Link from 'next/link';
import { ArrowUpRight, BriefcaseBusiness, CircleAlert, LoaderCircle, Search, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { date, humanize, salary } from '@/lib/client';
import type { Job } from '@/lib/ui-types';

export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'blue' | 'amber' | 'red' }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function Score({ score, compact = false }: { score: number | null; compact?: boolean }) {
  const label = score === null ? 'Not analyzed' : score >= 90 ? 'Excellent' : score >= 80 ? 'Strong' : score >= 70 ? 'Good' : score >= 60 ? 'Possible' : 'Weak';
  const tone = score === null ? 'neutral' : score >= 80 ? 'green' : score >= 60 ? 'blue' : 'amber';
  return <div className={`score score-${tone} ${compact ? 'score-compact' : ''}`}><span className="score-value">{score === null ? '—' : score}<span className="sr-only"> out of 100</span></span><span className="score-label">{label}</span></div>;
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
  return <label className="toggle-row"><div><span>{label}</span>{description && <small>{description}</small>}</div><input className="switch" type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} /></label>;
}
export function JobTable({ jobs }: { jobs: Job[] }) {
  return <div className="table-scroll"><table className="job-table"><thead><tr><th>Match</th><th>Opportunity</th><th>Location / work style</th><th>Salary</th><th>Source</th><th>Dates</th><th>Status</th><th><span className="sr-only">View</span></th></tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td><Score score={job.matchScore} compact /></td><td><Link className="job-title" href={`/jobs/${job.id}`}>{job.title}</Link><span className="table-secondary">{job.companyName}</span></td><td>{job.location || 'Not specified'}<span className="table-secondary">{humanize(job.remoteType)}</span></td><td className="nowrap">{salary(job.salaryMin, job.salaryMax, job.salaryCurrency)}<span className="table-secondary">{humanize(job.contractType)}</span></td><td>{job.sources?.map(source => humanize(source.provider)).filter((item, index, all) => all.indexOf(item) === index).join(', ') || 'Manual'}</td><td className="nowrap"><span title="Published date">{date(job.publishedAt)}</span><span className="table-secondary">Found {date(job.discoveredAt)}</span></td><td><Badge tone={job.application?.status === 'APPLIED' ? 'green' : 'neutral'}>{humanize(job.application?.status || job.status)}</Badge></td><td><Link className="icon-button" href={`/jobs/${job.id}`} aria-label={`View ${job.title}`}><ArrowUpRight size={17} /></Link></td></tr>)}</tbody></table></div>;
}
