'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, BriefcaseBusiness, ChevronRight, CircleHelp, Clock3, LayoutDashboard, LogOut, Menu, Moon, Network, Search, Settings2, SlidersHorizontal, Sparkles, Sun, UserRound, X } from 'lucide-react';
import { api, errorMessage, useResource } from '@/lib/client';
import { Feedback, Loading } from '@/components/ui';

const navigation = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/jobs', label: 'Discover jobs', icon: Search },
  { href: '/applications', label: 'Applications', icon: BriefcaseBusiness },
  { href: '/profile', label: 'My profile', icon: UserRound },
  { href: '/search-profiles', label: 'Search profiles', icon: SlidersHorizontal },
  { href: '/providers', label: 'Job sources', icon: Network },
  { href: '/runs', label: 'Search history', icon: Clock3 },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];

export function Logo() { return <Link href="/" className="brand" aria-label="Élan home"><span className="brand-mark"><Sparkles size={23} strokeWidth={1.8} /></span><span>élan<span className="brand-dot">.</span></span></Link>; }

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname(); const router = useRouter();
  const { data, error } = useResource<{ user: { id: string; email: string } | null; setupRequired: boolean }>('/api/auth/session');
  const [menuOpen, setMenuOpen] = useState(false); const [dark, setDark] = useState(false); const [logoutError, setLogoutError] = useState('');
  useEffect(() => { if (data && !data.user) router.replace('/login'); }, [data, router]);
  useEffect(() => { setDark(document.documentElement.dataset.theme === 'dark'); }, []);
  function toggleTheme() { const next = !dark; setDark(next); document.documentElement.dataset.theme = next ? 'dark' : 'light'; localStorage.setItem('elan-theme', next ? 'dark' : 'light'); }
  async function logout() { try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); router.replace('/login'); } catch (reason) { setLogoutError(errorMessage(reason)); } }
  const current = navigation.find(item => item.href === '/' ? pathname === '/' : pathname.startsWith(item.href));
  if (!data?.user) return <main className="session-loading"><Logo />{error ? <Feedback message={error} error /> : <Loading />}</main>;
  return <div className="app-shell">
    {menuOpen && <button className="sidebar-overlay" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}><div className="sidebar-brand"><Logo /><button className="icon-button mobile-only" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={20} /></button></div><div className="workspace-name"><span className="workspace-avatar">P</span><span>Personal workspace<small>Your next chapter</small></span></div><nav aria-label="Main navigation"><div className="nav-heading">WORKSPACE</div>{navigation.map((item, index) => <div key={item.href}>{index === 4 && <div className="nav-heading nav-heading-second">PREFERENCES & TOOLS</div>}<Link href={item.href} aria-current={current?.href === item.href ? 'page' : undefined} className={`nav-link ${current?.href === item.href ? 'active' : ''}`} onClick={() => setMenuOpen(false)}><item.icon size={19} strokeWidth={1.7} /><span>{item.label}</span>{current?.href === item.href && <span className="nav-active-dot" />}</Link></div>)}</nav><div className="sidebar-bottom"><div className="sidebar-note"><span className="note-icon"><Sparkles size={17} /></span><strong>A little more direction.</strong><p>Your experience. Your ambitions.<br />A search built around you.</p><Link href="/profile">Refine your profile <ArrowUpRight size={14} /></Link></div><div className="account"><span className="account-avatar">{data.user.email.slice(0, 1).toUpperCase()}</span><div><strong>My workspace</strong><span title={data.user.email}>{data.user.email}</span></div><button className="icon-button" onClick={logout} aria-label="Sign out"><LogOut size={17} /></button></div></div></aside>
    <div className="main-column"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-only" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu size={21} /></button><span className="desktop-only">Workspace</span><ChevronRight size={14} className="desktop-only" /><strong>{current?.label || 'Job details'}</strong></div><div className="topbar-actions"><span className="region-label"><span className="french-flag" /> France</span><span className="topbar-divider" /><button className="icon-button" onClick={toggleTheme} aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button><Link className="icon-button" href="/settings" aria-label="Workspace help and settings"><CircleHelp size={19} /></Link><span className="topbar-avatar">{data.user.email.slice(0, 1).toUpperCase()}</span></div></header><main className="page-content"><Feedback message={logoutError} error />{children}</main><footer className="app-footer"><span>Made for your next move.</span><span>Élan · Your personal job-search workspace</span></footer></div>
  </div>;
}
