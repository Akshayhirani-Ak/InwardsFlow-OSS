'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { InwardsFlowLogo } from '@/components/branding/InwardsFlowLogo';
import { Button } from '@/components/ui/Button';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import {
  Eye,
  EyeOff,
  AlertCircle,
  Boxes,
  FileCheck2,
  Calculator,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();

  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Phase 3: client-side attempt throttle (speed bump on top of Supabase
  // Auth's own rate limits) — 5 failures lock the form for 30 seconds.
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);

  // Surface fail-closed redirects from the auth context (?error=...)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err === 'suspended') {
      setErrorMessage('Account is suspended. Contact administrator.');
    } else if (err === 'no-profile') {
      setErrorMessage('Account is not provisioned yet. Contact administrator.');
    }
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const rawId = userId.trim().toLowerCase();
    if (!rawId) {
      setErrorMessage('Please enter your User ID.');
      return;
    }
    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    if (lockedUntil && Date.now() < lockedUntil) {
      setErrorMessage(
        `Too many failed attempts. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s.`
      );
      return;
    }

    // Closed enterprise model: append @inwardsflow.com if no @ was typed
    const email = rawId.includes('@') ? rawId : `${rawId}@inwardsflow.com`;

    try {
      setIsLoading(true);

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !data.user) {
        // Generic message — never reveal which part was wrong.
        throw new Error('Invalid User ID or password. Please verify credentials.');
      }

      // Phase 3 — FAIL-CLOSED profile verification. The old code ignored the
      // fetch error entirely: a missing profile (or a failed lookup) let the
      // session straight through. Now error, missing, and inactive all end it.
      const { data: profile, error: profileError } = await supabase
        .from('users_profile')
        .select('*')
        .eq('id', data.user.id)
        .maybeSingle();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        setErrorMessage('Account is not provisioned yet. Contact administrator.');
        setIsLoading(false);
        return;
      }

      if (profile.is_active === false) {
        await supabase.auth.signOut();
        setErrorMessage('Account is suspended. Contact administrator.');
        setIsLoading(false);
        return;
      }

      setFailedAttempts(0);
      setLockedUntil(null);
      router.push('/dashboard');
      router.refresh();
    } catch (err: unknown) {
      const attempts = failedAttempts + 1;
      setFailedAttempts(attempts);
      if (attempts >= 5) {
        setLockedUntil(Date.now() + 30_000);
        setErrorMessage('Too many failed attempts. Try again in 30s.');
      } else {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Authentication failed. Please verify credentials.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-white text-ink font-sans">
      {/* Main 50/50 Split Viewport Container */}
      <div className="flex-1 grid items-stretch bg-canvas lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-8 lg:p-8">
        {/* Left Showcase Panel (Desktop Only) */}
        <div className="hidden lg:flex rounded-panel bg-ink p-10 flex-col justify-between relative overflow-hidden">
          {/* Top Brand Lockup + Tagline Badge */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <InwardsFlowLogo size="login" />
              <span className="text-xl font-semibold tracking-tight text-white">
                InwardsFlow
              </span>
            </div>

            {/* Official AI Tagline Badge */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-selection/80 text-xs font-medium text-secondary">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              <span>AI-Powered Receiving • Self-Learning SKU Intelligence</span>
            </div>

            {/* Hero Headline & Subtext */}
            <div className="pt-2">
              <h1 className="text-[32px] font-semibold text-white tracking-tight leading-tight">
                Receive. Verify. Reconcile.
              </h1>
              <p className="text-soft text-base mt-3 max-w-md leading-relaxed">
                Streamlined inwards consignments, multi-container de-vanning, and automated pack-size intelligence in one platform.
              </p>
            </div>
          </div>

          {/* Center Modern Isometric Platform Illustration */}
          <div className="my-8 relative max-w-md mx-auto w-full flex items-center justify-center">
            {/* Isometric Platform Container with 4 Floating Cards */}
            <div className="relative w-full aspect-square max-w-[360px] flex items-center justify-center">
              {/* Isometric Central Dock Hex/Base */}
              <svg viewBox="0 0 400 300" className="w-full h-auto drop-shadow-sm">
                <polygon points="200,60 360,150 200,240 40,150" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
                <polygon points="40,150 200,240 200,265 40,175" fill="#E2E8F0" />
                <polygon points="360,150 200,240 200,265 360,175" fill="#CBD5E1" />

                {/* Central Inbound Receiving Cube */}
                <polygon points="200,105 255,135 200,165 145,135" fill="#1849B2" />
                <polygon points="145,135 200,165 200,210 145,180" fill="#081C3A" />
                <polygon points="255,135 200,165 200,210 255,180" fill="#1447B8" />

                {/* Ambient Grid Lines on Platform */}
                <line x1="120" y1="105" x2="280" y2="195" stroke="#F1F5F9" strokeWidth="1.5" />
                <line x1="280" y1="105" x2="120" y2="195" stroke="#F1F5F9" strokeWidth="1.5" />
              </svg>

              {/* Floating Card 1: Container Intake (Top-Left) */}
              <div className="absolute top-2 left-0 bg-white rounded-xl p-3 border border-line/90 shadow-overlay flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-selection text-accent flex items-center justify-center shrink-0">
                  <Boxes className="w-4 h-4" strokeWidth={2} />
                </div>
                <div className="leading-tight">
                  <div className="text-xs font-semibold text-ink">Container Intake</div>
                  <div className="text-[10px] text-muted">Multi-unit de-vanning</div>
                </div>
              </div>

              {/* Floating Card 2: Smart Box Math (Top-Right) */}
              <div className="absolute top-6 right-0 bg-white rounded-xl p-3 border border-line/90 shadow-overlay flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-selection text-accent flex items-center justify-center shrink-0">
                  <Calculator className="w-4 h-4" strokeWidth={2} />
                </div>
                <div className="leading-tight">
                  <div className="text-xs font-semibold text-ink">Smart Box Math</div>
                  <div className="text-[10px] text-muted">Half-box intelligence</div>
                </div>
              </div>

              {/* Floating Card 3: Pallet Ledger (Bottom-Left) */}
              <div className="absolute bottom-6 left-2 bg-white rounded-xl p-3 border border-line/90 shadow-overlay flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-attention text-warning flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4" strokeWidth={2} />
                </div>
                <div className="leading-tight">
                  <div className="text-xs font-semibold text-ink">Pallet Ledger</div>
                  <div className="text-[10px] text-muted">PLT-001 segregation</div>
                </div>
              </div>

              {/* Floating Card 4: GRN Verified (Bottom-Right) */}
              <div className="absolute bottom-2 right-2 bg-white rounded-xl p-3 border border-line/90 shadow-overlay flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-received text-positive flex items-center justify-center shrink-0">
                  <FileCheck2 className="w-4 h-4" strokeWidth={2} />
                </div>
                <div className="leading-tight">
                  <div className="text-xs font-semibold text-ink">GRN Verified</div>
                  <div className="text-[10px] text-muted">Instant reconciliation</div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom 3 Feature Pills */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="px-3 py-1.5 bg-surface rounded-card shadow-rest text-xs font-medium text-secondary">
              Instant Auto-Save
            </span>
            <span className="px-3 py-1.5 bg-surface rounded-card shadow-rest text-xs font-medium text-secondary">
              Self-Learning Catalog
            </span>
            <span className="px-3 py-1.5 bg-surface rounded-card shadow-rest text-xs font-medium text-secondary">
              Multi-Container Ready
            </span>
          </div>
        </div>

        {/* Right Sign-In Panel */}
        <div className="w-full flex flex-col items-center justify-center p-4 sm:p-8">
          {/* Mobile Header (Hidden on Desktop) */}
          <div className="lg:hidden text-center mb-6 space-y-3">
            <div className="flex items-center justify-center gap-2.5">
              <InwardsFlowLogo size="login" />
              <span className="text-xl font-bold tracking-tight text-ink">
                InwardsFlow
              </span>
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-selection border border-selection text-xs font-medium text-accent">
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              <span>AI-Powered Receiving • Self-Learning SKU Intelligence</span>
            </div>
          </div>

          {/* Sign-In Card */}
          <div className="max-w-[420px] w-full bg-surface rounded-panel shadow-rest p-6 sm:p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-ink tracking-tight">
                Welcome Back
              </h2>
              <p className="text-sm text-muted mt-1">
                Sign in to continue
              </p>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="mb-4 p-3 bg-damage border border-damage text-danger rounded-lg text-[13px] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSignIn} className="space-y-4">
              {/* User ID Field */}
              <div>
                <label className="block text-xs font-semibold text-secondary mb-1.5">
                  User ID
                </label>
                <input
                  type="text"
                  autoComplete="username"
                  placeholder="Enter User ID"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                  required
                  className="w-full h-11 px-3.5 rounded-lg border border-line text-base sm:text-sm text-ink placeholder-slate-400 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all font-sans"
                />
              </div>

              {/* Password Field with Eye Toggle */}
              <div>
                <label className="block text-xs font-semibold text-secondary mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full h-11 pl-3.5 pr-10 rounded-lg border border-line text-base sm:text-sm text-ink placeholder-slate-400 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all font-sans"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-secondary p-1"
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" strokeWidth={1.75} />
                    ) : (
                      <Eye className="w-4 h-4" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
              </div>

              {/* Sign In Button */}
              <Button type="submit" isLoading={isLoading} className="w-full mt-2">Sign In</Button>
            </form>

            {/* Footer Text */}
            <div className="text-xs text-muted text-center mt-6">
              Need access? Contact your administrator.
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Page Footer Bar */}
      <footer className="w-full py-4 px-8 border-t border-line/70 bg-soft flex flex-wrap items-center justify-between text-xs text-muted gap-3">
        <div>© 2026 InwardsFlow WMS</div>
        <div className="font-medium text-secondary">
          Warehouse Receiving &amp; Inbound Ledger
        </div>
        <div className="hidden sm:block text-muted">
          AI-Powered Receiving • Self-Learning SKU Intelligence
        </div>
      </footer>
    </div>
  );
}
