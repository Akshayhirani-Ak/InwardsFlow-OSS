// InwardsFlow Enterprise WMS â€” Auth & Permission Context
// InwardsFlow Receiving & Inventory Engine
'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type { UserProfile, PermissionKey, UserRole } from '@/types/wms';
import { toCleanUserId } from '@/lib/utils/auth-mapper';
import { rpcErrorMessage } from '@/lib/utils/errors';
import { useSessionIdleLock } from '@/hooks/useSessionIdleLock';

interface AuthPermissionContextType {
  user: User | null;
  profile: UserProfile | null;
  cleanUserId: string;
  role: UserRole;
  isMaster: boolean;
  hasPermission: (cap: PermissionKey) => boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  loading: boolean;
  isLocked: boolean;
  lockSession: () => void;
  unlockSession: () => void;
}

const AuthPermissionContext = createContext<AuthPermissionContextType | undefined>(undefined);

export function AuthPermissionProvider({ children }: { children: React.ReactNode }) {
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Phase 3 â€” FAIL-CLOSED profile resolution.
  // The old code created a profile client-side when none existed (first user
  // in an empty table became master_admin!) and, when that insert failed,
  // still set the fabricated profile in local state â€” a UI-level privilege
  // escalation. Now: profiles are provisioned ONLY by the database trigger
  // on auth-user creation and activated by a master. No profile, an inactive
  // profile, or a fetch error all end the session.
  const failClosed = useCallback(
    async (reason: 'suspended' | 'no-profile') => {
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignore network errors â€” the local session is dropped regardless.
      }
      setUser(null);
      setProfile(null);
      if (typeof window !== 'undefined') {
        window.location.href = `/login?error=${reason}`;
      }
    },
    [supabase]
  );

  const currentUserId = React.useRef<string | null>(null);
  const profileVersion = React.useRef(0);

  const resolveUserProfile = useCallback(async (id: string) => {
    const version = ++profileVersion.current;
    const current = () => id === currentUserId.current && version === profileVersion.current;
    try {
      const { data, error } = await supabase.from('users_profile').select('*').eq('id', id).maybeSingle();
      if (!current()) return;
      if (error || !data || !data.is_active) {
        setProfile(null);
        await failClosed(data && !error ? 'suspended' : 'no-profile');
        return;
      }
      setProfile(data as UserProfile);
    } catch {
      if (current()) await failClosed('no-profile');
    } finally {
      if (current()) setLoading(false);
    }
  }, [supabase, failClosed]);

  const refreshProfile = useCallback(async () => {
    if (currentUserId.current) await resolveUserProfile(currentUserId.current);
  }, [resolveUserProfile]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      clearTimeout(timer);
      const next = session?.user ?? null;
      if (currentUserId.current !== next?.id) setProfile(null);
      currentUserId.current = next?.id ?? null;
      setUser(next);
      if (!next) {
        setLoading(false);
        return;
      }
      // Supabase releases its auth lock after this callback returns.
      timer = setTimeout(() => void resolveUserProfile(next.id), 0);
    });
    return () => {
      clearTimeout(timer);
      currentUserId.current = null;
      subscription.unsubscribe();
    };
  }, [supabase, resolveUserProfile]);

  const hasPermission = useCallback(
    (cap: PermissionKey): boolean => {
      if (!profile) return false;
      if (profile.role === 'master_admin' || profile.perm_full_access) return true;
      if (cap === 'ai_intake') return Boolean(profile.perm_ai_intake);
      if (cap === 'view_all_containers') return Boolean(profile.perm_view_all_containers);
      if (cap === 'void_entries') return Boolean(profile.perm_void_entries);
      if (cap === 'export_reports') return Boolean(profile.perm_export_reports);
      return false;
    },
    [profile]
  );

  const signOut = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      window.alert(rpcErrorMessage(error, 'Unable to sign out. Please try again.'));
      return;
    }
    setUser(null);
    setProfile(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }, [supabase]);

  const cleanUserId = profile?.user_id || toCleanUserId(user?.email) || '';
  const role: UserRole = profile?.role || 'inwards_operator';
  const isMaster = role === 'master_admin' || Boolean(profile?.perm_full_access);

  const { isLocked, lockSession, unlockSession } = useSessionIdleLock({
    enabled: Boolean(user),
  });

  return (
    <AuthPermissionContext.Provider
      value={{
        user,
        profile,
        cleanUserId,
        role,
        isMaster,
        hasPermission,
        signOut,
        refreshProfile,
        loading,
        isLocked,
        lockSession,
        unlockSession,
      }}
    >
      {children}
    </AuthPermissionContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthPermissionContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthPermissionProvider');
  }
  return context;
}
