'use client';

import { rpcErrorMessage } from '@/lib/utils/errors';
import React, { useState } from 'react';
import { UserProfile, UserRole } from '@/types/wms';
import { Check, X, Edit2, AlertTriangle, Power } from 'lucide-react';
import { cleanDisplay } from '@/lib/utils/auth-mapper';

interface PermissionMatrixTableProps {
  users: UserProfile[];
  currentUserId: string;
  onUpdateRole: (targetUserId: string, newRole: UserRole) => Promise<void>;
  onUpdatePermission: (
    targetUserId: string,
    permissionKey: keyof UserProfile,
    value: boolean
  ) => Promise<void>;
  onUpdateFullName: (targetUserId: string, newFullName: string) => Promise<void>;
  onToggleActive: (targetUserId: string, currentStatus: boolean) => Promise<void>;
}

export const PermissionMatrixTable: React.FC<PermissionMatrixTableProps> = ({
  users,
  currentUserId,
  onUpdateRole,
  onUpdatePermission,
  onUpdateFullName,
  onToggleActive,
}) => {
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleToggle = async (
    targetUser: UserProfile,
    permissionKey: keyof UserProfile,
    currentValue: boolean
  ) => {
    // Prevent locking out Master
    if (targetUser.role === 'master_admin' && permissionKey === 'perm_full_access') {
      setErrorMessage('Master Admin full access cannot be revoked.');
      return;
    }

    try {
      setUpdatingId(`${targetUser.id}-${String(permissionKey)}`);
      setErrorMessage('');
      await onUpdatePermission(targetUser.id, permissionKey, !currentValue);
    } catch (err: unknown) {
      setErrorMessage(
        rpcErrorMessage(err, 'Failed to update user permission.')
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const handleStatusToggle = async (targetUser: UserProfile) => {
    if (targetUser.role === 'master_admin') {
      setErrorMessage('Master Administrator accounts cannot be suspended.');
      return;
    }

    try {
      setUpdatingId(`${targetUser.id}-active`);
      setErrorMessage('');
      const currentActive = targetUser.is_active !== false;
      await onToggleActive(targetUser.id, currentActive);
    } catch (err: unknown) {
      setErrorMessage(
        rpcErrorMessage(err, 'Failed to update account status.')
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSaveName = async (targetUser: UserProfile) => {
    const trimmed = tempName.trim();
    if (!trimmed) {
      setErrorMessage('Display name cannot be empty.');
      return;
    }

    try {
      setUpdatingId(`${targetUser.id}-name`);
      setErrorMessage('');
      await onUpdateFullName(targetUser.id, trimmed);
      setEditingNameId(null);
    } catch (err: unknown) {
      setErrorMessage(
        rpcErrorMessage(err, 'Failed to update operator name.')
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRoleChange = async (targetUser: UserProfile, newRole: UserRole) => {
    if (targetUser.role === 'master_admin' && newRole !== 'master_admin' && targetUser.user_id === currentUserId) {
      setErrorMessage('You cannot demote your own active Master Administrator account.');
      return;
    }

    try {
      setUpdatingId(`${targetUser.id}-role`);
      setErrorMessage('');
      await onUpdateRole(targetUser.id, newRole);
    } catch (err: unknown) {
      setErrorMessage(
        rpcErrorMessage(err, 'Failed to update user role.')
      );
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="bg-surface rounded-card shadow-rest overflow-hidden">
      {errorMessage && (
        <div className="p-3 bg-damage border-b border-damage text-danger text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-line bg-soft text-[11px] font-bold text-secondary uppercase tracking-wider">
              <th className="py-3 px-4 font-mono">User ID</th>
              <th className="py-3 px-4">Operator Full Name</th>
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4 text-center">Status</th>
              <th className="py-3 px-4 text-center">Full Access</th>
              <th className="py-3 px-4 text-center">Document Intake</th>
              <th className="py-3 px-4 text-center">View All</th>
              <th className="py-3 px-4 text-center">Void Entries</th>
              <th className="py-3 px-4 text-center">Export GRN</th>
              <th className="py-3 px-4 font-mono text-secondary">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-soft text-xs">
            {users.map((u) => {
              const isMaster = u.role === 'master_admin';
              const isCurrentUser = u.user_id === currentUserId;
              const isActive = u.is_active !== false;
              const isRowBusy = updatingId?.startsWith(u.id);
              const isEditingThisName = editingNameId === u.id;

              return (
                <tr
                  key={u.id}
                  className={`hover:bg-soft transition-colors ${
                    !isActive ? 'bg-soft/60 opacity-75' : ''
                  }`}
                >
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className="font-mono font-bold text-ink bg-soft px-2 py-0.5 rounded border border-line">
                      {cleanDisplay(u.user_id)}
                    </span>
                    {isCurrentUser && (
                      <span className="ml-1.5 text-[10px] text-accent font-bold">
                        (You)
                      </span>
                    )}
                  </td>

                  {/* Inline Full Name Editor */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    {isEditingThisName ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={tempName}
                          onChange={(e) => setTempName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveName(u);
                            if (e.key === 'Escape') setEditingNameId(null);
                          }}
                          className="px-2 py-1 text-xs border border-accent rounded focus:outline-none focus:ring-1 focus:ring-accent font-semibold text-ink bg-white"
                          autoFocus
                          disabled={isRowBusy}
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveName(u)}
                          disabled={isRowBusy}
                          className="p-1 rounded bg-received text-positive hover:bg-received"
                          title="Save Name"
                        >
                          <Check className="w-3.5 h-3.5" strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingNameId(null)}
                          disabled={isRowBusy}
                          className="p-1 rounded bg-soft text-secondary hover:bg-line"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" strokeWidth={1.75} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 group">
                        <span className="font-semibold text-ink">
                          {u.full_name}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingNameId(u.id);
                            setTempName(u.full_name);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-muted hover:text-accent rounded transition-opacity"
                          title="Edit Full Name"
                        >
                          <Edit2 className="w-3 h-3" strokeWidth={1.75} />
                        </button>
                      </div>
                    )}
                  </td>

                  <td className="py-3 px-4 whitespace-nowrap">
                    <select
                      value={u.role}
                      disabled={isRowBusy || (isMaster && isCurrentUser)}
                      onChange={(e) => handleRoleChange(u, e.target.value as UserRole)}
                      className={`text-xs font-semibold px-2.5 py-1 rounded-lg border focus:outline-none transition-colors cursor-pointer ${
                        u.role === 'master_admin'
                          ? 'bg-selection text-accent border-selection'
                          : 'bg-soft text-secondary border-line hover:bg-soft'
                      }`}
                    >
                      <option value="master_admin">Master Admin</option>
                      <option value="inwards_operator">Operator</option>
                    </select>
                  </td>

                  {/* Status & Activation Toggle */}
                  <td className="py-3 px-4 text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      {isActive ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-received text-positive border border-received">
                          ACTIVE
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-damage text-danger border border-damage">
                          SUSPENDED
                        </span>
                      )}

                      {!isMaster && (
                        <button
                          type="button"
                          onClick={() => handleStatusToggle(u)}
                          disabled={isRowBusy}
                          title={isActive ? 'Suspend operator access' : 'Activate operator access'}
                          className={`p-1 rounded transition-colors ${
                            isActive
                              ? 'text-muted hover:text-danger hover:bg-damage'
                              : 'text-muted hover:text-positive hover:bg-received'
                          }`}
                        >
                          <Power className="w-3.5 h-3.5" strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  </td>

                  {/* Checkbox: Full Access */}
                  <td className="py-3 px-4 text-center">
                                          <label className="inline-flex w-12 h-12 items-center justify-center">
<input
                      type="checkbox"
                        aria-label={`full access for ${u.full_name || u.user_id}`}
                      checked={u.perm_full_access}
                      disabled={isMaster || !isActive}
                      onChange={() => handleToggle(u, 'perm_full_access', u.perm_full_access)}
                      className="w-4 h-4 text-accent rounded border-line focus:ring-accent cursor-pointer disabled:opacity-50"
                    />
                      </label>
                  </td>

                  {/* Checkbox: Document Intake */}
                  <td className="py-3 px-4 text-center">
                                          <label className="inline-flex w-12 h-12 items-center justify-center">
<input
                      type="checkbox"
                        aria-label={`ai intake for ${u.full_name || u.user_id}`}
                      checked={u.perm_ai_intake || u.perm_full_access}
                      disabled={u.perm_full_access || !isActive}
                      onChange={() => handleToggle(u, 'perm_ai_intake', u.perm_ai_intake)}
                      className="w-4 h-4 text-accent rounded border-line focus:ring-accent cursor-pointer disabled:opacity-50"
                    />
                      </label>
                  </td>

                  {/* Checkbox: View All */}
                  <td className="py-3 px-4 text-center">
                                          <label className="inline-flex w-12 h-12 items-center justify-center">
<input
                      type="checkbox"
                        aria-label={`view all containers for ${u.full_name || u.user_id}`}
                      checked={u.perm_view_all_containers || u.perm_full_access}
                      disabled={u.perm_full_access || !isActive}
                      onChange={() =>
                        handleToggle(u, 'perm_view_all_containers', u.perm_view_all_containers)
                      }
                      className="w-4 h-4 text-accent rounded border-line focus:ring-accent cursor-pointer disabled:opacity-50"
                    />
                      </label>
                  </td>

                  {/* Checkbox: Void Entries */}
                  <td className="py-3 px-4 text-center">
                                          <label className="inline-flex w-12 h-12 items-center justify-center">
<input
                      type="checkbox"
                        aria-label={`void entries for ${u.full_name || u.user_id}`}
                      checked={u.perm_void_entries || u.perm_full_access}
                      disabled={u.perm_full_access || !isActive}
                      onChange={() =>
                        handleToggle(u, 'perm_void_entries', u.perm_void_entries)
                      }
                      className="w-4 h-4 text-accent rounded border-line focus:ring-accent cursor-pointer disabled:opacity-50"
                    />
                      </label>
                  </td>

                  {/* Checkbox: Export Reports */}
                  <td className="py-3 px-4 text-center">
                                          <label className="inline-flex w-12 h-12 items-center justify-center">
<input
                      type="checkbox"
                        aria-label={`export reports for ${u.full_name || u.user_id}`}
                      checked={u.perm_export_reports || u.perm_full_access}
                      disabled={u.perm_full_access || !isActive}
                      onChange={() =>
                        handleToggle(u, 'perm_export_reports', u.perm_export_reports)
                      }
                      className="w-4 h-4 text-accent rounded border-line focus:ring-accent cursor-pointer disabled:opacity-50"
                    />
                      </label>
                  </td>

                  <td className="py-3 px-4 font-mono text-[11px] text-muted tabular-nums whitespace-nowrap">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
