'use client';

export const dynamic = 'force-dynamic';

import { rpcErrorMessage } from '@/lib/utils/errors';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { AuditLog } from '@/types/wms';
import { useAuth } from '@/context/AuthPermissionContext';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Search,
  ArrowLeft,
  Clock,
  RefreshCw,
  Lock,
} from 'lucide-react';
import { cleanDisplay } from '@/lib/utils/auth-mapper';

export default function AuditLogPage() {
  const supabase = createBrowserSupabaseClient();
  const { isMaster } = useAuth();

  const [readError, setReadError] = useState('');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('ALL');

  const loadAuditLogs = useCallback(async () => {
    setIsLoading(true);
    setReadError('');
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      setLogs((data as AuditLog[]) || []);
    } catch (err) {
      setReadError(rpcErrorMessage(err, 'Unable to load activity.'));
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (isMaster) {
      loadAuditLogs();
    }
  }, [isMaster, loadAuditLogs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (filterType !== 'ALL' && log.action_type !== filterType) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const actorMatch = (log.actor_user_id || '').toLowerCase().includes(q);
        const detailsMatch = (log.details || '').toLowerCase().includes(q);
        const typeMatch = (log.action_type || '').toLowerCase().includes(q);
        if (!actorMatch && !detailsMatch && !typeMatch) return false;
      }
      return true;
    });
  }, [logs, filterType, searchQuery]);

  if (!isMaster) {
    return (
      <div className="flex-1 max-w-md mx-auto p-8 my-auto text-center">
        <div className="p-6 bg-surface rounded-card shadow-rest space-y-4">
          <div className="p-3 bg-damage text-danger rounded-full w-12 h-12 mx-auto flex items-center justify-center">
            <Lock className="w-6 h-6" strokeWidth={1.75} />
          </div>
          <h2 className="text-base font-bold text-ink">Master Clearance Required</h2>
          <p className="text-xs text-secondary">
            Immutable Enterprise Audit Logs are restricted to Master Administrators.
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

  return (
    <div className="flex-1 max-w-[1536px] w-full mx-auto p-4 sm:p-6 space-y-6">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink font-sans">
          Activity
        </h1>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={loadAuditLogs}
            disabled={isLoading}
            className="text-xs border-line"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.75} />
            Refresh Log
          </Button>
        </div>
      </div>

      {readError && <p role="alert" className="text-sm text-danger">{readError}</p>}
      {/* Filter and Search Bar */}
      <div className="bg-surface p-5 rounded-card shadow-rest flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-[280px]">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" strokeWidth={1.75} />
            <input
              type="text"
              placeholder="Search by User ID, Action, or keyword..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-soft border border-line rounded-lg focus:outline-none focus:ring-1 focus:ring-accent font-mono"
            />
          </div>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="text-xs font-mono bg-soft border border-line rounded-lg px-2.5 py-1.5 text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="ALL">All Actions</option>
            <option value="CONTAINER_INTAKE">CONTAINER_INTAKE</option>
            <option value="UPDATE_OPERATOR_NAME">UPDATE_OPERATOR_NAME</option>
            <option value="UPDATE_PERMISSION">UPDATE_PERMISSION</option>
            <option value="VOID_ENTRY">VOID_ENTRY</option>
            <option value="STATUS_CHANGE">STATUS_CHANGE</option>
            <option value="UPDATE_USER_STATUS">UPDATE_USER_STATUS</option>
          </select>
        </div>

        <span className="text-xs font-mono text-muted">
          Showing <strong>{filteredLogs.length}</strong> events
        </span>
      </div>

      {/* Logs Table */}
      <div className="bg-surface rounded-card shadow-rest overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-line bg-soft text-[11px] font-semibold text-secondary uppercase tracking-wider">
                <th className="py-3 px-4 font-mono w-48">Timestamp</th>
                <th className="py-3 px-4 font-mono w-40">Operator ID</th>
                <th className="py-3 px-4 w-44">Action Type</th>
                <th className="py-3 px-4">Audit Event Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-soft text-xs">
              {readError ? null : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-muted">
                    <Clock className="w-8 h-8 mx-auto mb-2 text-line" />
                    <p className="font-medium text-xs">No audit events match your criteria.</p>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-soft/70 transition-colors">
                    <td className="py-3 px-4 font-mono text-muted whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-mono font-bold text-ink bg-soft px-2 py-0.5 rounded border border-line">
                        {cleanDisplay(log.actor_user_id || log.actor_name)}
                      </span>
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <Badge variant="primary" size="sm" className="font-mono text-[10px]">
                        {log.action_type}
                      </Badge>
                    </td>

                    <td className="py-3 px-4 text-ink font-mono text-xs">
                      {log.details}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
