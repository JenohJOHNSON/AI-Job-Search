'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { EmptyState, Feedback, Loading, PageHeading, Score } from '@/components/ui';
import { Tracker } from '@/components/tracker';
import { api, date, errorMessage, humanize, useResource } from '@/lib/client';
import { applicationStatuses, type Application, type ApplicationStatus } from '@/lib/ui-types';

// The board shows seven stages; finer statuses (technical / final interview, withdrawn, ...) live inside them.
const columns: { id: string; title: string; target: ApplicationStatus; statuses: ApplicationStatus[] }[] = [
  { id: 'saved', title: 'Saved', target: 'SAVED', statuses: ['NEW', 'REVIEWED', 'SAVED', 'APPLY'] },
  { id: 'applied', title: 'Applied', target: 'APPLIED', statuses: ['APPLIED'] },
  { id: 'recruiter', title: 'Recruiter contact', target: 'RECRUITER_CONTACT', statuses: ['RECRUITER_CONTACT'] },
  { id: 'interview', title: 'Interview', target: 'INTERVIEW', statuses: ['INTERVIEW', 'TECHNICAL_INTERVIEW', 'FINAL_INTERVIEW'] },
  { id: 'offer', title: 'Offer', target: 'OFFER', statuses: ['OFFER'] },
  { id: 'rejected', title: 'Rejected', target: 'REJECTED', statuses: ['REJECTED', 'WITHDRAWN'] },
  { id: 'archived', title: 'Archived', target: 'ARCHIVED', statuses: ['ARCHIVED'] }
];

export default function ApplicationsPage() {
  const { data, error, loading, refresh } = useResource<{ applications: Application[] }>('/api/applications');
  const [message, setMessage] = useState(''), [open, setOpen] = useState<string | null>(null), [dragging, setDragging] = useState<string | null>(null), [over, setOver] = useState<string | null>(null);
  async function move(application: Application, status: ApplicationStatus) {
    if (application.status === status) return; setMessage('');
    try { await api(`/api/jobs/${application.jobId}/application`, { method: 'POST', body: JSON.stringify({ status }) }); refresh(); } catch (reason) { setMessage(errorMessage(reason)); }
  }
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [open]);
  const applications = data?.applications ?? []; const selected = applications.find(item => item.id === open);
  return <>
    <PageHeading eyebrow="PIPELINE" title="Every conversation, kept moving." description="Drag a card to a new stage, or use its stage menu. Open a card for notes, follow-ups, interview dates and the full activity history." />
    <Feedback message={message || error} error={Boolean(message || error)} />
    {loading ? <Loading /> : !applications.length ? <section className="panel"><EmptyState icon="job" title="Your application board is ready" description="Save a promising job from Discover and it appears here with its complete status history." action={<Link className="button" href="/jobs">Browse opportunities</Link>} /></section> : <div className="kanban7">{columns.map(column => {
      const cards = applications.filter(item => column.statuses.includes(item.status));
      return <section key={column.id} className={`kanban-column ${over === column.id ? 'drop' : ''}`} aria-label={`${column.title}, ${cards.length} applications`}
        onDragOver={event => { event.preventDefault(); setOver(column.id); }} onDragLeave={() => setOver(current => current === column.id ? null : current)}
        onDrop={event => { event.preventDefault(); setOver(null); const application = applications.find(item => item.id === dragging); setDragging(null); if (application && !column.statuses.includes(application.status)) void move(application, column.target); }}>
        <div className="kanban-head"><span>{column.title}</span><span>{cards.length}</span></div>
        {cards.map(application => {
          const due = application.nextActionDate && new Date(application.nextActionDate) < new Date(); const next = (application.interviewDates ?? []).map(value => new Date(value)).filter(value => value >= new Date()).sort((a, b) => +a - +b)[0];
          return <article key={application.id} className={`kanban-card ${dragging === application.id ? 'dragging' : ''}`} draggable onDragStart={() => setDragging(application.id)} onDragEnd={() => { setDragging(null); setOver(null); }}>
            <Link href={`/jobs/${application.jobId}`}><h3>{application.job.title}</h3><p>{application.job.companyName} · {application.job.location || 'Location not stated'}</p></Link>
            <Score score={application.job.rankScore} compact ai={application.job.matchScore !== null} />
            <div className="meta">{column.statuses.length > 1 && <span>{humanize(application.status)}</span>}{next && <span>Interview {date(next.toISOString(), true)}</span>}{application.nextAction && <span className={due ? 'due' : ''}>{application.nextAction}{application.nextActionDate ? ` · ${date(application.nextActionDate)}` : ''}</span>}{application.job.status !== 'ACTIVE' && <span className="due">Listing closed</span>}</div>
            <label className="field" style={{ marginTop: 10 }}><span className="sr-only">Stage for {application.job.title}</span><select value={application.status} onChange={event => move(application, event.target.value as ApplicationStatus)}>{applicationStatuses.map(status => <option value={status} key={status}>{humanize(status)}</option>)}</select></label>
            <button className="link" style={{ marginTop: 8 }} onClick={() => setOpen(application.id)}>Notes &amp; follow-up</button>
          </article>;
        })}
      </section>;
    })}</div>}
    {selected && <div className="drawer-overlay" onClick={() => setOpen(null)}><aside className="drawer" role="dialog" aria-modal="true" aria-label={`Application for ${selected.job.title}`} onClick={event => event.stopPropagation()}>
      <div className="drawer-head"><div><h2>{selected.job.title}</h2><p className="table-secondary">{selected.job.companyName}</p></div><button className="icon-button" aria-label="Close" onClick={() => setOpen(null)}><X size={18} /></button></div>
      <Tracker key={selected.id + selected.status + (selected.history?.length ?? 0)} job={{ ...selected.job, application: selected }} onSaved={refresh} />
    </aside></div>}
  </>;
}
