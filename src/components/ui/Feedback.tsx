import React, { type ReactNode } from 'react';

export function Banner({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? 'alert' : 'status'} className={`rounded-control px-4 py-3 text-sm ${error ? 'bg-damage text-danger' : 'bg-selection text-ink'}`}>{children}</div>;
}

export function ListState({ children, loading = false }: { children: ReactNode; loading?: boolean }) {
  return <div role="status" className="flex min-h-32 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted">
    {loading && <div aria-hidden="true" className="h-2 w-24 rounded-full bg-soft motion-safe:animate-pulse" />}
    {children}
  </div>;
}
