'use client';
import { useState } from 'react';
import { LoaderCircle, Play } from 'lucide-react';
import { api, errorMessage } from '@/lib/client';
import { Feedback } from '@/components/ui';

export function RunButton({ onQueued }: { onQueued?: () => void }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [failed, setFailed] = useState(false);
  async function run() { setBusy(true); setMessage(''); try { const result = await api<{ status: string }>('/api/search/run', { method: 'POST', body: '{}' }); setMessage(`Search ${result.status.toLowerCase()}. Follow its progress in Search history.`); setFailed(false); onQueued?.(); } catch (error) { setFailed(true); setMessage(errorMessage(error)); } finally { setBusy(false); } }
  return <div className="run-action"><button className="button button-primary" disabled={busy} onClick={run}>{busy ? <LoaderCircle size={16} className="spin" /> : <Play size={15} />} {busy ? 'Queuing search…' : 'Run job search'}</button><Feedback message={message} error={failed} /></div>;
}
