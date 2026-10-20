'use client';
import { useEffect, useState } from 'react';
import { Download, Send, Trash2 } from 'lucide-react';
import { Badge, Feedback, Field, Loading, PageHeading, Toggle } from '@/components/ui';
import { api, errorMessage, humanize, modelName, useResource } from '@/lib/client';
import type { Settings } from '@/lib/ui-types';

const zones = ['Europe/Paris', 'Europe/Luxembourg', 'Europe/Brussels', 'Europe/Berlin', 'Europe/London', 'UTC'];

export default function SettingsPage() {
  const { data, error, loading, refresh } = useResource<Settings>('/api/settings');
  const [form, setForm] = useState<Settings | null>(null), [message, setMessage] = useState(''), [failed, setFailed] = useState(false), [busy, setBusy] = useState(''), [confirmation, setConfirmation] = useState('');
  useEffect(() => { if (data) setForm(data); }, [data]);
  const notify = (text: string, isError = false) => { setMessage(text); setFailed(isError); };
  if (loading || !form) return <Loading />;
  const patch = <G extends 'notifications' | 'schedule' | 'limits'>(group: G, values: Partial<Settings[G]>) => setForm(current => current ? { ...current, [group]: { ...current[group], ...values } } : current);
  async function save() {
    if (!form) return; setBusy('save'); notify('');
    try {
      await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ notifications: { emailEnabled: form.notifications.emailEnabled, telegramEnabled: form.notifications.telegramEnabled, minScore: form.notifications.minScore, maxPerDigest: form.notifications.maxPerDigest }, schedule: form.schedule, ai: { maxAnalysesPerDay: form.limits.maxAiAnalysesPerDay, maxCostPerDay: form.limits.maxLlmCostPerDay, matchThreshold: form.limits.aiMatchThreshold }, limits: { maxJobsPerProvider: form.limits.maxJobsPerProvider, maxTotalJobsPerRun: form.limits.maxTotalJobsPerRun } }) });
      notify('Settings saved.'); refresh();
    } catch (reason) { notify(errorMessage(reason), true); } finally { setBusy(''); }
  }
  async function test(channel: 'EMAIL' | 'TELEGRAM') {
    setBusy(channel); notify('');
    try { await api('/api/settings/notifications/test', { method: 'POST', body: JSON.stringify({ channel }) }); notify(`A test message was sent to ${humanize(channel)}.`); } catch (reason) { notify(errorMessage(reason), true); } finally { setBusy(''); }
  }
  async function remove() {
    try { await api('/api/privacy', { method: 'DELETE', body: JSON.stringify({ confirmation }) }); location.href = '/login'; } catch (reason) { notify(errorMessage(reason), true); }
  }
  const { ai, ceilings, notifications } = form; const scoring = form.scoring;
  return <>
    <PageHeading eyebrow="SETTINGS" title="Guardrails for a deliberate search." description="Secrets and hard spending ceilings come from the server environment. Everything below can be lowered or tuned here." action={<button className="button" disabled={busy === 'save'} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save settings'}</button>} />
    <Feedback message={message || error} error={failed || Boolean(error)} />
    <div className="grid two">
      <section className="panel"><div className="panel-head"><h2>AI matching</h2><Badge tone={ai.configured || scoring.configured ? 'green' : 'amber'}>{ai.configured || scoring.configured ? 'Configured' : 'Not configured'}</Badge></div><div className="panel-body section-stack">
        <div><h3 className="settings-subhead">Multi-model job scoring (OpenRouter) <Badge tone={scoring.configured ? 'green' : 'amber'}>{scoring.configured ? 'Active' : scoring.keyConfigured ? 'No model configured' : 'Needs OPENROUTER_API_KEY'}</Badge></h3>
          <ol className="slot-list">{scoring.slots.map(slot => <li key={slot.slot}><strong>{modelName(slot.models[0])}</strong> <code>{slot.models[0]}</code>{slot.models.length > 1 && <small>Fallbacks, in order: {slot.models.slice(1).map(model => `${modelName(model)} (${model})`).join(' → ')}</small>}</li>)}</ol>
          {scoring.invalid.length > 0 && <p className="table-secondary" role="alert">Ignored malformed model IDs: {scoring.invalid.join(', ')}.</p>}
          <p className="table-secondary" style={{ margin: 0 }}>Each job above the threshold is scored by every slot on the same rubric; the final score is the average of the valid answers. A model that is rate limited, unavailable, out of context or timed out is retried once when that can help, then replaced by its slot’s next fallback. Change the models with <code>AI_SCORING_SLOT_1</code>–<code>3</code> (comma-separated, primary first) and reasoning with <code>AI_SCORING_REASONING_EFFORT</code> (now {scoring.reasoningEffort}). Prices are read from OpenRouter.</p></div>
        <div><h3 className="settings-subhead">CV extraction and documents</h3><p style={{ margin: 0 }}><strong>{humanize(ai.provider)}</strong> · {ai.model || 'no model selected'}{ai.fallbackModel && ` · fallback ${ai.fallbackModel}`}</p></div>
        {ai.configured || scoring.configured ? <p className="table-secondary" style={{ margin: 0 }}>AI refines the rule-based score for the best candidates, within the limits below.{!ai.configured && <> CV extraction and document drafts additionally need: <strong>{ai.missing.join(', ')}</strong>.</>}</p> : <p className="table-secondary" style={{ margin: 0 }}>Scores and notifications work without AI, using the transparent rule-based engine. For multi-model scoring set <strong>OPENROUTER_API_KEY</strong>; for CV extraction and documents set <strong>{ai.missing.join(', ')}</strong>. Your provider account should have its own spend limit too.</p>}
        <Field label={`Daily AI requests (max ${ceilings.maxAiAnalysesPerDay})`} hint="Every model call counts, so multi-model scoring uses one request per model and job."><input type="number" min={0} max={ceilings.maxAiAnalysesPerDay} value={form.limits.maxAiAnalysesPerDay} onChange={event => patch('limits', { maxAiAnalysesPerDay: Number(event.target.value) })} /></Field>
        <Field label={`Daily AI budget in USD (max ${ceilings.maxLlmCostPerDay})`}><input type="number" min={0} max={ceilings.maxLlmCostPerDay} step="0.1" value={form.limits.maxLlmCostPerDay} onChange={event => patch('limits', { maxLlmCostPerDay: Number(event.target.value) })} /></Field>
        <Field label={`Only analyse jobs scoring at least ${form.limits.aiMatchThreshold}`}><div className="range-row"><input type="range" min={0} max={100} step={5} value={form.limits.aiMatchThreshold} onChange={event => patch('limits', { aiMatchThreshold: Number(event.target.value) })} /><output>{form.limits.aiMatchThreshold}</output></div></Field>
      </div></section>
      <section className="panel"><div className="panel-head"><h2>Search volume</h2></div><div className="panel-body section-stack">
        <Field label={`Stored jobs per source per run (max ${ceilings.maxJobsPerProvider})`}><input type="number" min={1} max={ceilings.maxJobsPerProvider} value={form.limits.maxJobsPerProvider} onChange={event => patch('limits', { maxJobsPerProvider: Number(event.target.value) })} /></Field>
        <Field label={`Stored jobs per run in total (max ${ceilings.maxTotalJobsPerRun})`}><input type="number" min={1} max={ceilings.maxTotalJobsPerRun} value={form.limits.maxTotalJobsPerRun} onChange={event => patch('limits', { maxTotalJobsPerRun: Number(event.target.value) })} /></Field>
        <p className="table-secondary" style={{ margin: 0 }}>The best-scoring vacancies are kept first when a limit applies.</p>
      </div></section>
      <section className="panel"><div className="panel-head"><h2>Notifications</h2></div><div className="panel-body section-stack">
        <Toggle label="Email digest" description={notifications.emailAvailable ? 'New high-scoring jobs, each announced once.' : 'Needs EMAIL_FROM, DIGEST_TO and RESEND_API_KEY or SMTP_URL in the environment.'} checked={notifications.emailEnabled} onChange={value => patch('notifications', { emailEnabled: value })} />
        <Toggle label="Telegram digest" description={notifications.telegramAvailable ? 'The same digest as a Telegram message.' : 'Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the environment.'} checked={notifications.telegramEnabled} onChange={value => patch('notifications', { telegramEnabled: value })} />
        <Field label={`Notify me for matches of ${notifications.minScore} or more`} hint="80 and above is a Strong Match, 65 a Good Match."><div className="range-row"><input type="range" min={30} max={100} step={5} value={notifications.minScore} onChange={event => patch('notifications', { minScore: Number(event.target.value) })} /><output>{notifications.minScore}</output></div></Field>
        <Field label="Maximum jobs per digest"><input type="number" min={1} max={25} value={notifications.maxPerDigest} onChange={event => patch('notifications', { maxPerDigest: Number(event.target.value) })} /></Field>
        <div className="actions" style={{ marginTop: 0 }}><button className="button secondary" disabled={!notifications.emailAvailable || Boolean(busy)} onClick={() => test('EMAIL')}><Send size={14} /> Send test email</button><button className="button secondary" disabled={!notifications.telegramAvailable || Boolean(busy)} onClick={() => test('TELEGRAM')}><Send size={14} /> Send test Telegram</button></div>
        <p className="table-secondary" style={{ margin: 0 }}>Save first, then test. A job is announced once, never again, and never if you dismissed it or already applied.</p>
      </div></section>
      <section className="panel"><div className="panel-head"><h2>Daily search</h2></div><div className="panel-body section-stack">
        <Toggle label="Run a search every day" description="Done by the background worker; it needs no browser and no GitHub schedule." checked={form.schedule.enabled} onChange={value => patch('schedule', { enabled: value })} />
        <Field label="Time"><input type="time" value={form.schedule.time} onChange={event => patch('schedule', { time: event.target.value })} /></Field>
        <Field label="Time zone" hint="Daylight-saving changes are handled automatically."><input list="zones" value={form.schedule.timezone} onChange={event => patch('schedule', { timezone: event.target.value })} /><datalist id="zones">{zones.map(zone => <option key={zone} value={zone} />)}</datalist></Field>
        <p className="table-secondary" style={{ margin: 0 }}>The schedule only fires once you have a profile, an active search profile and an enabled source. The optional GitHub Actions workflow is a backup trigger and never creates a duplicate run.</p>
      </div></section>
      <section className="panel"><div className="panel-head"><h2>Privacy</h2></div><div className="panel-body section-stack">
        <a className="button secondary" href="/api/privacy/export"><Download size={15} /> Export my personal data</a>
        <Field label="Type DELETE MY DATA to erase the account and all private records"><input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></Field>
        <button className="button danger" disabled={confirmation !== 'DELETE MY DATA'} onClick={remove}><Trash2 size={15} /> Delete private workspace</button>
        <p className="table-secondary" style={{ margin: 0 }}>Public vacancy data is not personal and is kept; your profile, resumes, applications and documents are deleted permanently.</p>
      </div></section>
    </div>
  </>;
}
