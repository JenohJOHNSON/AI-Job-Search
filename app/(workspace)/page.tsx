'use client';
import Link from 'next/link';
import { ArrowUpRight, BriefcaseBusiness, Bookmark, CalendarClock, CircleCheck, Circle, Network, Radar, Send, Sparkles, TriangleAlert, Layers } from 'lucide-react';
import { Badge, Bar, EmptyState, Feedback, JobTable, Loading, PageHeading, Score } from '@/components/ui';
import { RunButton } from '@/components/run-button';
import { ago, date, humanize, useResource } from '@/lib/client';
import type { Job, Provider, Run } from '@/lib/ui-types';

type Dashboard = {
  stats: { total: number; newJobs: number; highMatches: number; saved: number; submitted: number; interviewing: number; upcomingInterviews: number; activeProviders: number; failures: number; lastSearchAt: string | null };
  topJobs: Job[]; recentJobs: Job[]; providers: Provider[]; recentRuns: Run[];
  upcomingInterviews: { date: string; jobId: string; title: string; companyName: string; stage: string }[];
  followUps: { applicationId: string; jobId: string; title: string; companyName: string; nextAction: string | null; nextActionDate: string | null }[];
  usage: { analyses: number; cost: number; maxAnalyses: number; maxCost: number; configured: boolean };
  threshold: number;
  setup: { profile: boolean; searchProfile: boolean; source: boolean; firstRun: boolean; ai: boolean; notifications: boolean };
};

export default function DashboardPage() {
  const { data, error, loading, refresh } = useResource<Dashboard>('/api/dashboard', 15000);
  if (loading) return <Loading />;
  if (!data) return <Feedback message={error} error />;
  const { stats, setup } = data;
  const tiles = [
    { label: 'Open jobs found', value: stats.total, icon: Layers, href: '/jobs' }, { label: 'New in 24 h', value: stats.newJobs, icon: Radar, href: '/jobs?sort=newest' },
    { label: `High matches (${data.threshold}+)`, value: stats.highMatches, icon: Sparkles, href: '/jobs?score=' + data.threshold }, { label: 'Saved', value: stats.saved, icon: Bookmark, href: '/jobs?view=saved' },
    { label: 'Applications sent', value: stats.submitted, icon: Send, href: '/applications' }, { label: 'Upcoming interviews', value: stats.upcomingInterviews, icon: CalendarClock, href: '/applications' },
    { label: 'Sources active', value: stats.activeProviders, icon: Network, href: '/providers' }, { label: 'Source failures (24 h)', value: stats.failures, icon: TriangleAlert, href: '/runs' }
  ];
  const steps = [
    { done: setup.profile, title: 'Complete your profile', text: 'Target roles, skills and locations drive every score.', href: '/profile' },
    { done: setup.searchProfile, title: 'Create a search profile', text: 'Titles and places to search.', href: '/search-profiles' },
    { done: setup.source, title: 'Enable a job source', text: 'Add Greenhouse, Lever, Ashby boards or France Travail.', href: '/providers' },
    { done: setup.firstRun, title: 'Run your first search', text: 'A background worker fetches and scores vacancies.', href: '/runs' }
  ];
  const ready = steps.every(step => step.done);
  return <>
    <PageHeading eyebrow="OVERVIEW" title="Your search, in focus." description="Fresh opportunities, clear evidence, and one calm place to decide what deserves your attention." action={<RunButton onQueued={refresh} />} />
    <Feedback message={error} error />
    {!ready && <section className="panel" style={{ marginBottom: 18 }}><div className="panel-head"><h2>Get started</h2><span className="table-secondary">{steps.filter(step => step.done).length}/{steps.length} done</span></div><div className="setup-steps">{steps.map(step => <Link key={step.title} href={step.href} className={`setup-step ${step.done ? 'done' : ''}`}><strong>{step.done ? <CircleCheck size={16} color="#1f9d73" /> : <Circle size={16} />}{step.title}</strong><p>{step.text}</p></Link>)}</div></section>}
    <div className="stats stats-8">{tiles.map(item => <Link href={item.href} className="stat" key={item.label}><span><item.icon size={14} /> {item.label}</span><strong>{item.value}</strong></Link>)}</div>
    <div className="grid two">
      <section className="panel"><div className="panel-head"><h2>Best opportunities</h2><Link href="/jobs?sort=score">View all <ArrowUpRight size={14} /></Link></div>
        {data.topJobs.length ? data.topJobs.map(job => <div className="job-card" key={job.id}><div className="job-card-top"><div><Link className="job-title" href={`/jobs/${job.id}`}>{job.title}</Link><p>{job.companyName} · {job.location || 'Location not stated'}</p></div><Score score={job.rankScore} compact ai={job.matchScore !== null} /></div></div>) : <EmptyState icon="sparkles" title="Your shortlist starts here" description="Once a search has run, the best-scoring vacancies appear here with the evidence behind each score." />}
      </section>
      <section className="panel"><div className="panel-head"><h2>Interviews and follow-ups</h2><Link href="/applications">Pipeline <ArrowUpRight size={14} /></Link></div>
        {data.upcomingInterviews.length || data.followUps.length ? <>{data.upcomingInterviews.map(item => <div className="job-card" key={item.date + item.jobId}><div className="job-card-top"><div><Link className="job-title" href={`/jobs/${item.jobId}`}>{item.title}</Link><p>{item.companyName} · {humanize(item.stage)}</p></div><Badge tone="blue">{date(item.date, true)}</Badge></div></div>)}{data.followUps.map(item => <div className="job-card" key={item.applicationId}><div className="job-card-top"><div><Link className="job-title" href={`/jobs/${item.jobId}`}>{item.nextAction || 'Follow up'}</Link><p>{item.title} · {item.companyName}</p></div><Badge tone={item.nextActionDate && new Date(item.nextActionDate) < new Date() ? 'red' : 'amber'}>{date(item.nextActionDate)}</Badge></div></div>)}</> : <EmptyState icon="job" title="Nothing scheduled" description="Interview dates and follow-up reminders you add to an application show up here." />}
      </section>
    </div>
    <div className="grid two" style={{ marginTop: 18 }}>
      <section className="panel"><div className="panel-head"><h2>Source health</h2><Link href="/providers">Configure</Link></div>
        {data.providers.filter(provider => provider.enabled).length ? data.providers.filter(provider => provider.enabled).map(provider => <div className="job-card" key={provider.id}><div className="job-card-top"><div><h3>{provider.name}</h3><p>{provider.message || 'Waiting for its next run.'}</p></div><span className={`badge ${provider.status === 'HEALTHY' ? 'badge-green' : provider.status === 'FAILED' ? 'badge-red' : 'badge-amber'}`}>{humanize(provider.status)}</span></div></div>) : <EmptyState title="No active sources" description="Enable an official source and add the employer boards you want to follow." action={<Link className="button secondary" href="/providers">Add a source</Link>} />}
      </section>
      <section className="panel"><div className="panel-head"><h2>Recent searches</h2><Link href="/runs">History</Link></div>
        {data.recentRuns.length ? data.recentRuns.map(run => <div className="job-card" key={run.id}><div className="job-card-top"><div><Badge tone={run.status === 'FINISHED' ? 'green' : run.status === 'FAILED' ? 'red' : 'blue'}>{humanize(run.status)}</Badge> <span className="table-secondary" style={{ display: 'inline' }}>{ago(run.createdAt)} · {humanize(run.trigger)}</span><p style={{ marginTop: 6 }}>{run.jobsNew} new · {run.jobsDuplicate} already known · {run.providersSuccessful}/{run.providersAttempted} sources ok</p></div></div></div>) : <EmptyState title="No searches yet" description="Run a search now, or let the daily schedule do it." />}
      </section>
    </div>
    <section className="panel" style={{ marginTop: 18 }}><div className="panel-head"><h2>AI usage today</h2><Badge tone={data.usage.configured ? 'green' : 'amber'}>{data.usage.configured ? 'AI configured' : 'Rule-based scoring only'}</Badge></div><div className="panel-body">
      {data.usage.configured ? <div className="grid two"><div className="meter"><div className="meter-top"><span>Requests</span><strong>{data.usage.analyses} / {data.usage.maxAnalyses}</strong></div><Bar value={data.usage.analyses} max={Math.max(1, data.usage.maxAnalyses)} label="AI requests used today" /></div><div className="meter"><div className="meter-top"><span>Estimated cost</span><strong>${data.usage.cost.toFixed(3)} / ${data.usage.maxCost.toFixed(2)}</strong></div><Bar value={data.usage.cost} max={Math.max(0.0001, data.usage.maxCost)} label="AI budget used today" /></div></div> : <p className="table-secondary">Matching works without an AI key: every score comes from the transparent rule-based engine. Configure a model in the environment to add AI refinement within your daily limits.</p>}
    </div></section>
    <section className="panel" style={{ marginTop: 18 }}><div className="panel-head"><h2>Recently discovered</h2><span className="table-secondary">{stats.lastSearchAt ? `Last successful search ${ago(stats.lastSearchAt)}` : 'No completed search yet'}</span></div>{data.recentJobs.length ? <JobTable jobs={data.recentJobs} /> : <EmptyState icon="job" title="No jobs discovered yet" description="Real results appear here after a configured source completes a search." action={<span className="table-secondary"><BriefcaseBusiness size={14} /> No sample data is ever shown.</span>} />}</section>
  </>;
}
