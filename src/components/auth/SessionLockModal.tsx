'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Lock, LogOut, KeyRound, AlertTriangle, Loader2 } from 'lucide-react';
import { InwardsFlowLogo } from '@/components/branding/InwardsFlowLogo';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { rpcErrorMessage } from '@/lib/utils/errors';
import { useAuth } from '@/context/AuthPermissionContext';

interface SessionLockModalProps {
  isOpen: boolean;
  onUnlock: () => void;
}

export function SessionLockModal({ isOpen, onUnlock }: SessionLockModalProps) {
  const { user, profile, cleanUserId, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setErrorMsg('');
      const t = setTimeout(() => {
        passwordInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const displayName = profile?.full_name || cleanUserId || user?.email || 'Operator';
  const displayRole = profile?.role === 'master_admin' ? 'Master' : 'Warehouse Operator';

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || !user?.email) return;

    try {
      setIsVerifying(true);
      setErrorMsg('');
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: password,
      });

      if (error) {
        throw error;
      }

      setPassword('');
      onUnlock();
    } catch (err: unknown) {
      setErrorMsg(rpcErrorMessage(err, 'Authentication failed. Please verify your password.'));
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/80 backdrop-blur-sm no-print">
      <div className="w-full max-w-md bg-white border border-edge rounded-lg shadow-2xl p-6 sm:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-line">
          <div className="flex items-center gap-2.5">
            <InwardsFlowLogo size="sm" />
            <span className="text-base font-bold tracking-tight text-ink">InwardsFlow</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-attention border border-attention text-warning text-xs font-mono font-bold">
            <Lock className="w-3.5 h-3.5" strokeWidth={2} />
            <span>TERMINAL LOCKED</span>
          </div>
        </div>

        {/* Notice & Context */}
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold text-ink">Floor Session Paused</h2>
          <p className="text-xs text-secondary">
            Terminal locked for floor security. Your workbench state, active container, pallet
            selection, and queued tallies are intact.
          </p>
        </div>

        {/* Operator Badge */}
        <div className="p-3 bg-soft border border-line rounded-control flex items-center justify-between">
          <div>
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
              Current Operator
            </span>
            <span className="font-mono text-sm font-bold text-ink">{displayName}</span>
          </div>
          <span className="text-xs font-mono text-accent font-semibold">{displayRole}</span>
        </div>

        {/* Password Form */}
        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-ink mb-1.5" htmlFor="terminal-password">
              Enter password to unlock
            </label>
            <div className="relative">
              <KeyRound
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                strokeWidth={1.75}
              />
              <input
                id="terminal-password"
                ref={passwordInputRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Account password"
                disabled={isVerifying}
                autoComplete="current-password"
                className="w-full pl-9 pr-3 py-2.5 min-h-[48px] text-sm font-mono bg-white border border-edge rounded-control focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2 p-3 bg-damage border border-damage rounded-control text-xs text-danger font-medium">
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" strokeWidth={2} />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-2 pt-2">
            <button
              type="submit"
              disabled={isVerifying || !password}
              className="w-full min-h-[48px] bg-accent hover:bg-pressed disabled:opacity-40 text-white font-bold text-sm rounded-control transition-colors flex items-center justify-center gap-2"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                  <span>Verifying credentials...</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" strokeWidth={2} />
                  <span>Unlock Terminal</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => void signOut()}
              className="w-full min-h-[44px] bg-white border border-edge text-ink hover:bg-soft text-xs font-semibold rounded-control transition-colors flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5 text-muted" strokeWidth={1.75} />
              <span>Switch User / Sign Out</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
