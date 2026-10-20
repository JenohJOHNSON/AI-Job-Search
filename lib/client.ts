'use client';

import { useCallback, useEffect, useState } from 'react';

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, credentials: 'same-origin', headers: { ...(!(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data ? String(data.error) : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return data as T;
}

export function useResource<T>(url: string, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    api<T>(url, { signal: controller.signal }).then(result => { if (active) { setData(result); setError(''); } }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Something went wrong.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [url, revision]);
  useEffect(() => { if (!refreshMs) return; const timer = setInterval(refresh, refreshMs); return () => clearInterval(timer); }, [refresh, refreshMs]);
  return { data, error, loading, refresh };
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
export const humanize = (text: string | null | undefined) => text ? text.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()) : 'Not specified';
export const date = (value: string | null | undefined, time = false) => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(value)) : '—';
export const salary = (minimum: number | null, maximum: number | null, currency = 'EUR') => {
  if (minimum === null && maximum === null) return 'Salary not listed';
  const format = (value: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return minimum !== null && maximum !== null ? `${format(minimum)} – ${format(maximum)}` : minimum !== null ? `From ${format(minimum)}` : `Up to ${format(maximum!)}`;
};
export const lines = (value: string) => value.split(/[,\n]/).map(item => item.trim()).filter(Boolean);
export const ago = (value: string | null | undefined) => {
  if (!value) return '—'; const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 2) return 'just now'; if (minutes < 60) return `${minutes} min ago`; const hours = Math.round(minutes / 60); if (hours < 36) return `${hours} h ago`; return `${Math.round(hours / 24)} d ago`;
};
/** datetime-local inputs use the browser's zone; the API stores ISO instants. */
export const toLocalInput = (value: string | null | undefined) => { if (!value) return ''; const d = new Date(value); const pad = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fromLocalInput = (value: string) => value ? new Date(value).toISOString() : null;
export const providerName: Record<string, string> = { france_travail: 'France Travail', greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', generic: 'Career page', manual: 'Manual import', email_alerts: 'Job-alert emails', linkedin: 'LinkedIn', indeed: 'Indeed', hellowork: 'HelloWork', wttj: 'Welcome to the Jungle' };
/** "anthropic/claude-sonnet-5.5" → "Claude Sonnet 5.5", "openai/gpt-6-astra" → "GPT-6 Astra". */
export const modelName = (id: string | null | undefined) => {
  if (!id) return 'Unknown model';
  const words = id.replace(/^~?[^/]*\//, '').replace(/:.*$/, '').split('-').filter(Boolean);
  if (words[0]?.toLowerCase() === 'gpt' && words[1]) words.splice(0, 2, `GPT-${words[1]}`);
  return words.map(word => /^gpt-/i.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};
