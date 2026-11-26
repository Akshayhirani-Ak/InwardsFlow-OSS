'use client';

export const dynamic = 'force-dynamic';

import { rpcErrorMessage } from '@/lib/utils/errors';
import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { UserProfile, UserRole } from '@/types/wms';
import { useAuth } from '@/context/AuthPermissionContext';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { PermissionMatrixTable } from '@/components/admin/PermissionMatrixTable';
import { Button } from '@/components/ui/Button';
import {
  Users,
  ArrowLeft,
  Lock,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserX,
} from 'lucide-react';

export default function UsersAdminPage() {
  const supabase = createBrowserSupabaseClient();
  const { isMaster, cleanUserId } = useAuth();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const loadUsers = useCallback(async () => {
    try {
      setErrorMessage('');
      const { data, error } = await supabase
        .from('users_profile')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;
      setUsers((data as UserProfile[]) || []);
    } catch (err: unknown) {
      console.error('Failed to load users:', err);
      setErrorMessage(
        rpcErrorMessage(err, 'Failed to synchronize user profiles.')
      );
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (isMaster) {
      loadUsers();
    }
  }, [isMaster, loadUsers]);

  // Phase 3: ALL profile writes go through the admin_update_profile RPC.
  // The server enforces the permission cascades (grant Full Access -> subs
  // on; revoke Full Access -> subs OFF — the old browser code missed the
  // revoke case and left privilege residue), self-protection, and
  // last-master protection. Audit rows come from the database trigger.
  const applyAdminUpdate = async (
    targetUserId: string,
    args: {
      p_full_name?: string;
      p_role?: UserRole;
      p_is_active?: boolean;
      p_perms?: Record<string, boolean>;
    }
  ) => {
    const { data, error } = await supabase.rpc('admin_update_profile', {
      p_target_id: targetUserId,
      p_full_name: args.p_full_name ?? null,
      p_role: args.p_role ?? null,
      p_is_active: args.p_is_active ?? null,
      p_perms: args.p_perms ?? null,
    });

    if (error) throw error;

    const updated = data as unknown as UserProfile | null;
    if (!updated || updated.id !== targetUserId) throw new Error('No updated profile returned. Refresh before retrying.');
    setUsers((prev) => prev.map((u) => (u.id === targetUserId ? updated : u)));
  };

  const handleUpdatePermission = async (
    targetUserId: string,
    permissionKey: keyof UserProfile,
    value: boolean
  ) => {
    await applyAdminUpdate(targetUserId, {
      p_perms: { [permissionKey]: value },
    });
  };

  const handleUpdateFullName = async (targetUserId: string, newFullName: string) => {
    await applyAdminUpdate(targetUserId, { p_full_name: newFullName });
  };

  const handleToggleActive = async (targetUserId: string, currentStatus: boolean) => {
    await applyAdminUpdate(targetUserId, { p_is_active: !currentStatus });
  };

  const handleUpdateRole = async (targetUserId: string, newRole: UserRole) => {
    await applyAdminUpdate(targetUserId, { p_role: newRole });
  };

  if (!isMaster) {
    return (
      <div className="flex-1 max-w-md mx-auto p-8 my-auto text-center">
        <div className="p-6 bg-surface rounded-card shadow-rest space-y-4">
          <div className="p-3 bg-damage text-danger rounded-full w-12 h-12 mx-auto flex items-center justify-center">
            <Lock className="w-6 h-6" strokeWidth={1.75} />
          </div>
          <h2 className="text-base font-bold text-ink">Master Clearance Required</h2>
          <p className="text-xs text-secondary">
            User Access is restricted exclusively to Master Administrators.
          </p>
          <Link href="/dashboard" className="inline-block pt-2">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.75} />
              Return to Floor Registry
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const masterCount = users.filter((u) => u.role === 'master_admin').length;
  const activeOperatorCount = users.filter(
    (u) => u.role === 'inwards_operator' && u.is_active !== false
  ).length;
  const suspendedCount = users.filter((u) => u.is_active === false).length;

  return (
    <div className="flex-1 max-w-[1536px] w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Top Action Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-ink tracking-tight font-sans">
          Users
        </h1>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              loadUsers();
            }}
            className="text-xs border-line"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.75} />
            Sync Directory
          </Button>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 bg-damage border border-damage text-danger rounded-lg text-xs">
          {errorMessage}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-surface p-5 rounded-card shadow-rest">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
              Total Pre-Provisioned
            </span>
            <Users className="w-4 h-4 text-muted" strokeWidth={1.75} />
          </div>
          <div className="text-2xl font-black font-mono text-ink mt-1 tabular-nums">
            {users.length}
          </div>
          <span className="text-[10px] text-muted">Directory profiles</span>
        </div>

        <div className="bg-surface p-5 rounded-card shadow-rest">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-accent">
              Master Administrators
            </span>
            <ShieldCheck className="w-4 h-4 text-accent" strokeWidth={1.75} />
          </div>
          <div className="text-2xl font-black font-mono text-accent mt-1 tabular-nums">
            {masterCount}
          </div>
          <span className="text-[10px] text-muted">Full system governance</span>
        </div>

        <div className="bg-surface p-5 rounded-card shadow-rest">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-positive">
              Active Operators
            </span>
            <UserCheck className="w-4 h-4 text-positive" strokeWidth={1.75} />
          </div>
          <div className="text-2xl font-black font-mono text-positive mt-1 tabular-nums">
            {activeOperatorCount}
          </div>
          <span className="text-[10px] text-muted">Floor receiving clearance</span>
        </div>

        <div className="bg-surface p-5 rounded-card shadow-rest">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-danger">
              Suspended Access
            </span>
            <UserX className="w-4 h-4 text-danger" strokeWidth={1.75} />
          </div>
          <div className="text-2xl font-black font-mono text-danger mt-1 tabular-nums">
            {suspendedCount}
          </div>
          <span className="text-[10px] text-muted">Suspended directory logins</span>
        </div>
      </div>

      {/* Matrix Table */}
      {isLoading ? (
        <div className="p-16 text-center text-muted bg-surface rounded-card shadow-rest">
          <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin text-accent" strokeWidth={1.75} />
          <p className="font-mono text-xs font-semibold text-ink">
            Synchronizing User Security Matrix...
          </p>
        </div>
      ) : (
        <PermissionMatrixTable
          users={users}
          currentUserId={cleanUserId}
          onUpdateRole={handleUpdateRole}
          onUpdatePermission={handleUpdatePermission}
          onUpdateFullName={handleUpdateFullName}
          onToggleActive={handleToggleActive}
        />
      )}
    </div>
  );
}
