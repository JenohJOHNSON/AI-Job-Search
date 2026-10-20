'use client';
import { useState, type FormEvent } from 'react';
import { Plus, Send, Trash2 } from 'lucide-react';
import { Badge, Feedback, Field } from '@/components/ui';
import { api, date, errorMessage, fromLocalInput, humanize, toLocalInput } from '@/lib/client';
import { applicationStatuses, type ApplicationStatus, type Job } from '@/lib/ui-types';

/** Notes, stage, follow-up, interview dates and activity history for one application. */
export function Tracker({ job, onSaved }: { job: Job; onSaved: () => void }) {
  const application = job.application;
  const [status, setStatus] = useState<ApplicationStatus>(application?.status ?? 'SAVED'), [notes, setNotes] = useState(application?.notes ?? ''), [nextAction, setNextAction] = useState(application?.nextAction ?? ''), [nextActionDate, setNextActionDate] = useState(toLocalInput(application?.nextActionDate)), [contact, setContact] = useState(application?.contact ?? ''), [salaryDiscussed, setSalaryDiscussed] = useState(application?.salaryDiscussed?.toString() ?? ''), [interviews, setInterviews] = useState<string[]>((application?.interviewDates ?? []).map(toLocalInput));
  const [message, setMessage] = useState(''), [failed, setFailed] = useState(false), [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(''); setFailed(false);
    try { await api(`/api/jobs/${job.id}/application`, { method: 'POST', body: JSON.stringify({ status, notes, nextAction, nextActionDate: fromLocalInput(nextActionDate), contact, salaryDiscussed: salaryDiscussed ? Number(salaryDiscussed) : null, interviewDates: interviews.filter(Boolean).map(value => fromLocalInput(value)!) }) }); setMessage('Application saved.'); onSaved(); }
    catch (reason) { setFailed(true); setMessage(errorMessage(reason)); } finally { setBusy(false); }
  }
  return <section className="panel"><div className="panel-head"><h2>Application tracker</h2>{application && <Badge tone="blue">{humanize(application.status)}</Badge>}</div>
    <form className="panel-body" onSubmit={save}><Feedback message={message} error={failed} />
      <div className="form-grid">
        <Field label="Stage"><select value={status} onChange={event => setStatus(event.target.value as ApplicationStatus)}>{applicationStatuses.map(value => <option key={value} value={value}>{humanize(value)}</option>)}</select></Field>
        <Field label="Recruiter / contact"><input value={contact} onChange={event => setContact(event.target.value)} maxLength={500} /></Field>
        <Field label="Next action"><input value={nextAction} onChange={event => setNextAction(event.target.value)} placeholder="e.g. Follow up by email" maxLength={1000} /></Field>
        <Field label="Follow-up date"><input type="datetime-local" value={nextActionDate} onChange={event => setNextActionDate(event.target.value)} /></Field>
        <Field label="Salary discussed (€/year)"><input type="number" min="0" value={salaryDiscussed} onChange={event => setSalaryDiscussed(event.target.value)} /></Field>
        <div className="field"><span>Interview dates</span>{interviews.map((value, index) => <div className="range-row" key={index}><input type="datetime-local" value={value} aria-label={`Interview ${index + 1}`} onChange={event => setInterviews(current => current.map((item, position) => position === index ? event.target.value : item))} /><button type="button" className="icon-button" aria-label={`Remove interview ${index + 1}`} onClick={() => setInterviews(current => current.filter((_, position) => position !== index))}><Trash2 size={15} /></button></div>)}<button type="button" className="button secondary" style={{ justifySelf: 'start' }} onClick={() => setInterviews(current => [...current, ''])}><Plus size={14} /> Add interview</button></div>
        <Field label="Notes" className="wide"><textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={10000} rows={5} /></Field>
      </div>
      <div className="form-actions"><button className="button" disabled={busy}><Send size={15} /> {busy ? 'Saving…' : application ? 'Update application' : 'Start tracking'}</button></div>
      {application?.history && application.history.length > 0 && <><h3>Activity</h3><ul className="timeline">{application.history.map((entry, index) => <li key={entry.id ?? index}>{entry.fromStatus ? `${humanize(entry.fromStatus)} → ` : ''}<strong>{humanize(entry.toStatus)}</strong><small>{date(entry.createdAt, true)}</small></li>)}</ul></>}
    </form></section>;
}
