'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AuthPermissionProvider, useAuth } from '@/context/AuthPermissionContext';
import { AppHeader } from '@/components/branding/AppHeader';
import { AppFooter } from '@/components/branding/AppFooter';
import { InwardsFlowLogo } from '@/components/branding/InwardsFlowLogo';
import { SessionLockModal } from '@/components/auth/SessionLockModal';
import { Loader2 } from 'lucide-react';

function ProtectedContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, profile, loading, isLocked, unlockSession } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-canvas">
        <InwardsFlowLogo size="md" />
        <div className="flex items-center gap-2 mt-4 text-xs font-mono font-bold text-secondary">
          <Loader2 className="w-4 h-4 animate-spin text-accent" strokeWidth={1.75} />
          Synchronizing InwardsFlow Security Context...
        </div>
      </div>
    );
  }

  if (!user || !profile?.is_active || profile.id !== user.id) {
    return null;
  }

  return (
    <div className="min-h-dvh flex flex-col bg-canvas">
      <AppHeader />
      <main className="flex-1 flex flex-col">{children}</main>
      <AppFooter />
      <SessionLockModal isOpen={isLocked} onUnlock={unlockSession} />
    </div>
  );
}

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthPermissionProvider>
      <ProtectedContent>{children}</ProtectedContent>
    </AuthPermissionProvider>
  );
}
