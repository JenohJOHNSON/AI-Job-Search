'use client';
import { RunButton } from '@/components/run-button';
import { Badge, EmptyState, Feedback, Loading, PageHeading } from '@/components/ui';
import { ago, date, humanize, providerName, useResource } from '@/lib/client';
import type { Run } from '@/lib/ui-types';

type RunError = { provider: string; code: string; message: string };
const tone = (status: string) => status === 'FINISHED' || status === 'HEALTHY' ? 'green' : status === 'FAILED' ? 'red' : status === 'DEGRADED' ? 'amber' : 'blue';
const seconds = (run: Run) => run.startedAt && run.completedAt ? Math.max(1, Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)) : null;

export default function RunsPage() {
  const { data, error, loading, refresh } = useResource<{ runs: Run[] }>('/api/search/runs', 5000);
  return <>
    <PageHeading eyebrow="OPERATIONS" title="A transparent search history." description="Every run records its trigger, what each source returned, duplicates merged, removed listings and any failure, so nothing fails silently." action={<RunButton onQueued={refresh} />} />
    <Feedback message={error} error />
    {loading ? <Loading /> : !data?.runs.length ? <section className="panel"><EmptyState title="No searches have run yet" description="Run one now, or let the daily schedule do it. The background worker picks it up and this page updates by itself." /></section> :
      <section className="panel">{data.runs.map(run => {
        const errors = (Array.isArray(run.errors) ? run.errors : []) as RunError[]; const took = seconds(run);
        return <details className="run-row" key={run.id} open={run.status === 'FAILED' || run.status === 'RUNNING' || run.status === 'QUEUED'}>
          <summary style={{ gridColumn: '1 / -1', cursor: 'pointer', display: 'grid', gridTemplateColumns: '160px 1fr 1fr 1fr', gap: 15, alignItems: 'center' }}>
            <div><Badge tone={tone(run.status)}>{humanize(run.status)}</Badge><span className="table-secondary">{date(run.createdAt, true)} · {humanize(run.trigger)}{took ? ` · ${took}s` : ''}</span></div>
            <div><strong>{run.jobsNew} new</strong><span className="table-secondary">{run.jobsDuplicate} already known · {run.jobsDiscovered} seen</span></div>
            <div><strong>{run.jobsAnalyzed} AI analysed</strong><span className="table-secondary">{run.jobsHighMatch} high matches</span></div>
            <div><strong>{run.providersSuccessful}/{run.providersAttempted} sources ok</strong><span className="table-secondary">{run.providersFailed} failed · {ago(run.createdAt)}</span></div>
          </summary>
          <div className="run-detail">
            {run.providerRuns?.map(provider => { const stats = provider.extractorStats ?? {}; return <div key={`${run.id}-${provider.provider}`} className="provider-line"><Badge tone={tone(provider.status)}>{humanize(provider.status)}</Badge><strong>{providerName[provider.provider] ?? provider.provider}</strong><span className="table-secondary" style={{ margin: 0 }}>{stats.fetched ?? provider.jobsDiscovered ?? 0} listed · {stats.relevant ?? 0} relevant · {stats.stored ?? 0} stored ({stats.newJobs ?? 0} new){stats.removed ? ` · ${stats.removed} closed` : ''}{provider.durationMs ? ` · ${(provider.durationMs / 1000).toFixed(1)}s` : ''}</span>{provider.errorMessage && <small style={{ flexBasis: '100%', color: 'var(--muted)' }}>{provider.errorMessage}</small>}</div>; })}
            {errors.map((item, index) => <div key={index} className="feedback feedback-error" role="status"><span><strong>{item.provider === '-' ? 'Run' : providerName[item.provider] ?? item.provider} · {humanize(item.code)}:</strong> {item.message}</span></div>)}
            {!run.providerRuns?.length && !errors.length && <span className="table-secondary">Waiting for the worker…</span>}
          </div>
        </details>;
      })}</section>}
  </>;
}
