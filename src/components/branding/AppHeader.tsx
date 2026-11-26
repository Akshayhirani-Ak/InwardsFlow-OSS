'use client';

import React, { useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, ClipboardList, LayoutDashboard, Lock, LogOut, Menu, Package, PlusCircle, Users, X } from 'lucide-react';
import { useAuth } from '@/context/AuthPermissionContext';
import { InwardsFlowLogo } from './InwardsFlowLogo';

export function AppHeader() {
  const path = usePathname();
  const sheet = useRef<HTMLDialogElement>(null);
  const { profile, cleanUserId, role, isMaster, hasPermission, signOut, lockSession } = useAuth();
  const receiving = isMaster || hasPermission('ai_intake');
  const master = role === 'master_admin' || isMaster;
  const sections = [
    { title: 'Receiving', links: [
      { href: '/dashboard', label: 'Inwards', icon: LayoutDashboard, show: true },
      { href: '/intake', label: 'Receive', icon: PlusCircle, show: receiving },
      { href: '/purchase-orders', label: 'POs', icon: ClipboardList, show: receiving },
    ] },
    { title: 'Library', links: [{ href: '/catalog', label: 'Catalog', icon: Package, show: true }] },
    { title: 'Admin', links: [
      { href: '/users', label: 'Users', icon: Users, show: master },
      { href: '/audit', label: 'Activity', icon: Activity, show: isMaster },
    ] },
  ];
  const active = (href: string) => path === href || path.startsWith(href + '/') || (href === '/dashboard' && path.startsWith('/workbench'));
  const nav = <nav>{sections.filter(s => s.links.some(l => l.show)).map(s =>
    <div className="nav-group" key={s.title}>
      <p>{s.title}</p>
      {s.links.filter(l => l.show).map(({ href, label, icon: Icon }) =>
        <Link key={href} href={href} title={label} aria-current={active(href) ? 'page' : undefined} onClick={() => sheet.current?.close()}>
          <Icon size={20} strokeWidth={1.75} /><span>{label}</span>
        </Link>)}
    </div>)}</nav>;
  const account = <div className="nav-account">
    <div><span className="mr-2 inline-block h-2 w-2 rounded-full bg-go" title="Online" />{profile?.full_name || cleanUserId || 'Operator'}<small>{master ? 'Master' : 'Operator'}</small></div>
    <button title="Lock Terminal (Shift Handover / Inactivity)" onClick={() => { sheet.current?.close(); lockSession(); }}><Lock size={16} />Lock</button>
    <button title="Sign Out" onClick={() => { sheet.current?.close(); signOut(); }}><LogOut size={16} />Sign Out</button>
  </div>;
  return <header className="app-navigation no-print" data-floor={path.startsWith('/workbench')}>
    <Link className="nav-brand" href="/dashboard"><InwardsFlowLogo size="md" /><span>InwardsFlow</span></Link>
    <div className="nav-desktop">{nav}{account}</div>
    <button className="nav-opener" aria-label="Menu" onClick={() => sheet.current?.showModal()}><Menu size={24} /></button>
    <dialog ref={sheet} className="nav-sheet" aria-label="Menu" onClick={e => { if(e.target === sheet.current) sheet.current?.close(); }}>
      <div><button className="ml-auto flex items-center justify-center" aria-label="Close" onClick={() => sheet.current?.close()}><X size={20} /></button>{nav}{account}</div>
    </dialog>
  </header>;
}
