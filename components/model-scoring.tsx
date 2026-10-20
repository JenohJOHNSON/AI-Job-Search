'use client';

import { CircleCheck, CircleHelp, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Badge, Bar } from '@/components/ui';
import { ago, humanize, modelName } from '@/lib/client';
import type { ModelScore, Qualification, Scoring } from '@/lib/ui-types';

// Mirrors the rubric in ai/scoring.ts; the weights are shown so the final number can be checked by hand.
const dimensions: { key: string; label: string; weight: number }[] = [
  { key: 'skills', label: 'Skills match', weight: 22 }, { key: 'requirements', label: 'Job requirements', weight: 20 }, { key: 'experience', label: 'Relevant experience', weight: 15 },
  { key: 'overall', label: 'Overall suitability', weight: 15 }, { key: 'seniority', label: 'Seniority alignment', weight: 10 }, { key: 'location', label: 'Location compatibility', weight: 10 }, { key: 'workStyle', label: 'Work-style compatibility', weight: 8 }
];
const statusTone = { COMPLETE: 'green', PARTIAL: 'amber', FAILED: 'red', RUNNING: 'blue' } as const;
const reasons: Record<string, string> = {
  RATE_LIMIT: 'rate limited', TIMEOUT: 'timed out', PROVIDER: 'provider error', NETWORK: 'network error', UNAVAILABLE: 'unavailable', CONTEXT_LIMIT: 'context window too small', OUTPUT_LIMIT: 'answer cut off at the token limit',
  QUOTA: 'OpenRouter credits exhausted', AUTH: 'API key rejected', MODERATION: 'refused', BAD_REQUEST: 'request rejected', INVALID_RESPONSE: 'invalid answer', BUDGET: 'daily AI budget reached', DUPLICATE_MODEL: 'already used by another slot', DEADLINE: 'time limit reached', STOPPED: 'scoring stopped'
};
const reason = (code?: string) => code ? reasons[code] ?? humanize(code) : 'failed';
const seconds = (ms: number) => ms ? `${(ms / 1000).toFixed(1)} s` : '—';
const usd = (value: number | null) => value === null ? '—' : `$${value < 0.01 ? value.toFixed(4) : value.toFixed(3)}`;

function slotStatus(score: ModelScore, running: boolean) {
  if (score.status === 'PENDING') return running ? <Badge tone="blue"><LoaderCircle size={11} className="spin" /> Scoring…</Badge> : <Badge>Not run</Badge>;
  if (score.status === 'FAILED') return <Badge tone="red">Failed</Badge>;
  return score.fallbackUsed ? <Badge tone="amber" title={`${modelName(score.primaryModel)} could not score; a configured fallback answered instead.`}>Scored · fallback</Badge> : <Badge tone="green">Scored</Badge>;
}

function Qualifications({ title, items }: { title: string; items: Qualification[] }) {
  if (!items.length) return null;
  return <><h3>{title}</h3><ul className="evidence-list">{items.map(item => <li key={item.requirement} className={item.status === 'met' ? 'ev-ok' : item.status === 'missing' ? 'ev-gap' : 'ev-unknown'}>
    {item.status === 'met' ? <CircleCheck size={14} /> : item.status === 'missing' ? <TriangleAlert size={14} /> : <CircleHelp size={14} />}
    <span>{item.requirement} — <strong>{item.status === 'met' ? 'met' : item.status === 'missing' ? 'missing' : item.verified === false && item.evidence ? 'unclear (the cited evidence is not in your profile)' : 'unclear'}</strong>{item.status === 'met' && item.evidence ? <small className="table-secondary" style={{ display: 'inline' }}> · {item.evidence}</small> : null}</span></li>)}</ul></>;
}

function ModelDetail({ score }: { score: ModelScore }) {
  const assessment = score.result?.assessment; const computed = score.result?.computed;
  return <details className="model-detail">
    <summary><strong>Slot {score.slot} · {modelName(score.model ?? score.primaryModel)}</strong> {score.score !== null ? `${score.score}/100` : score.status === 'PENDING' ? '— waiting for the model' : `— ${reason(score.attempts.at(-1)?.code)}`}{assessment ? ` · ${humanize(assessment.recommendation)}` : ''}</summary>
    {assessment && computed && <div className="model-detail-body">
      <p>{assessment.summary}</p>
      <div className="breakdown-grid">{dimensions.map(item => { const dimension = assessment.dimensions[item.key]; return dimension ? <div className="breakdown-item" key={item.key}><div className="dimension-head"><span>{item.label} <small className="table-secondary" style={{ display: 'inline' }}>×{item.weight}%</small></span><strong>{dimension.score}/100</strong></div><Bar value={dimension.score} max={100} label={`${item.label} score from ${modelName(score.model)}`} /><p className="table-secondary">{dimension.reasoning}</p></div> : null; })}</div>
      <p className="table-secondary">Weighted rubric score {computed.weighted}{computed.missingRequired ? `; ${computed.missingRequired} mandatory requirement${computed.missingRequired === 1 ? '' : 's'} missing, so capped at 55${computed.missingRequired > 1 ? ` minus ${7 * (computed.missingRequired - 1)}` : ''}` : ''} → {computed.score}.</p>
      <Qualifications title="Mandatory requirements" items={assessment.requiredQualifications} />
      <Qualifications title="Preferred qualifications" items={assessment.preferredQualifications} />
      {assessment.matchedSkills.length > 0 && <><h3>Matched skills (from your profile)</h3><div className="pill-list">{assessment.matchedSkills.map(skill => <span className="pill pill-ok" key={skill}>{skill}</span>)}</div></>}
      {assessment.missingInformation.length > 0 && <><h3>Information missing</h3><ul className="evidence-list">{assessment.missingInformation.map(item => <li key={item} className="ev-unknown"><CircleHelp size={14} /><span>{item}</span></li>)}</ul></>}
    </div>}
    <h3>Attempts</h3>
    <ul className="evidence-list">{score.attempts.length ? score.attempts.map((attempt, index) => <li key={index} className={attempt.outcome === 'SCORED' ? 'ev-ok' : attempt.outcome === 'FAILED' ? 'ev-gap' : 'ev-unknown'}>{attempt.outcome === 'SCORED' ? <CircleCheck size={14} /> : attempt.outcome === 'FAILED' ? <TriangleAlert size={14} /> : <CircleHelp size={14} />}<span>{modelName(attempt.model)}{attempt.retry ? ' (retry)' : ''}: {attempt.outcome === 'SCORED' ? 'scored' : `${attempt.outcome === 'SKIPPED' ? 'skipped' : 'failed'}, ${reason(attempt.code)}`}{attempt.latencyMs ? ` · ${seconds(attempt.latencyMs)}` : ''}{attempt.message && attempt.outcome !== 'SCORED' ? <small className="table-secondary">{attempt.message}</small> : null}</span></li>) : <li className="ev-unknown"><CircleHelp size={14} /><span>Waiting for the model.</span></li>}</ul>
    <p className="table-secondary">{score.inputTokens + score.outputTokens} tokens · {usd(score.costUsd)} · {seconds(score.latencyMs)}</p>
  </details>;
}

/** One multi-model scoring: progress while it runs, then each model's score, the model that actually answered, and the average. */
export function ModelScoring({ scoring, jobAverage }: { scoring: Scoring; jobAverage: number | null }) {
  const running = scoring.status === 'RUNNING'; const answered = scoring.scores.filter(score => score.status !== 'PENDING').length;
  const label = running ? `Scoring… ${answered} of ${scoring.slotsPlanned} models answered` : scoring.status === 'COMPLETE' ? `All ${scoring.slotsPlanned} models scored` : scoring.status === 'PARTIAL' ? `Reduced coverage: ${scoring.slotsScored} of ${scoring.slotsPlanned} models` : 'No model could score this job';
  const summaries = scoring.scores.filter(score => score.result?.assessment.summary);
  return <section className="panel" aria-busy={running}>
    <div className="panel-head"><h2>Multi-model AI score</h2><Badge tone={statusTone[scoring.status]}>{label}</Badge></div>
    <div className="panel-body section-stack">
      {running && <div className="progress-track" role="progressbar" aria-label="Models answered" aria-valuemin={0} aria-valuemax={scoring.slotsPlanned} aria-valuenow={answered}><span style={{ width: `${scoring.slotsPlanned ? answered / scoring.slotsPlanned * 100 : 0}%` }} /></div>}
      <div className="ensemble-summary">
        <div className="ensemble-average"><span className="ensemble-value">{scoring.averageScore !== null ? scoring.averageScore.toFixed(2) : '—'}</span><span>/100 · final average</span></div>
        {summaries.length > 0 && <ul className="ensemble-reasons">{summaries.map(score => <li key={score.slot}><strong>{modelName(score.model)}:</strong> {score.result!.assessment.summary}</li>)}</ul>}
      </div>
      {scoring.status === 'FAILED' && <div className="feedback feedback-error" role="alert"><TriangleAlert size={17} /><span>No valid score was produced{scoring.error ? `: ${scoring.error}` : '.'} {jobAverage !== null ? `The previous AI average (${jobAverage.toFixed(2)}) still applies.` : 'The rule-based score is used instead; nothing was estimated.'}</span></div>}
      {scoring.status === 'PARTIAL' && <div className="feedback" role="status"><CircleHelp size={17} /><span>Only {scoring.slotsScored} of {scoring.slotsPlanned} models returned a valid score, so the average uses {scoring.slotsScored === 1 ? 'that single model' : 'those models only'}. Failed models are never counted.</span></div>}
      <div className="table-scroll"><table className="model-table">
        <thead><tr><th>Slot</th><th>Model that scored</th><th>Score</th><th>Status</th><th>Time</th></tr></thead>
        <tbody>{scoring.scores.map(score => <tr key={score.slot}>
          <td>{score.slot}</td>
          <td><strong>{modelName(score.model ?? score.primaryModel)}</strong><span className="table-secondary">{score.model ?? score.primaryModel}{score.fallbackUsed ? ` · replaced ${modelName(score.primaryModel)}` : ''}</span></td>
          <td className="model-score">{score.score ?? '—'}</td>
          <td>{slotStatus(score, running)}{score.status === 'FAILED' && score.error && <span className="table-secondary">{score.error}</span>}</td>
          <td className="nowrap">{seconds(score.latencyMs)}</td>
        </tr>)}
          <tr className="model-total"><td colSpan={2}>Final average of {scoring.slotsScored} valid score{scoring.slotsScored === 1 ? '' : 's'}</td><td className="model-score">{scoring.averageScore !== null ? scoring.averageScore.toFixed(2) : '—'}</td><td colSpan={2}>{usd(scoring.costUsd)} · {scoring.inputTokens + scoring.outputTokens} tokens</td></tr>
        </tbody>
      </table></div>
      <div>{scoring.scores.map(score => <ModelDetail key={score.slot} score={score} />)}</div>
      <p className="table-secondary" style={{ margin: 0 }}>Every model gets the same rubric and the same profile, preferences and job text. Élan computes each model’s score from its rubric answers (a missing mandatory requirement caps it at 55) and averages only valid answers. {scoring.completedAt ? `Scored ${ago(scoring.completedAt)}.` : `Started ${ago(scoring.createdAt)}.`}</p>
    </div>
  </section>;
}
