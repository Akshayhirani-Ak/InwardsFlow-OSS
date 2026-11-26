'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const STORAGE_LOCK_KEY = 'inwardsflow_session_locked';

interface UseSessionIdleLockOptions {
  timeoutMs?: number;
  enabled?: boolean;
}

export function useSessionIdleLock({
  timeoutMs = FIFTEEN_MINUTES_MS,
  enabled = true,
}: UseSessionIdleLockOptions = {}) {
  const [isLocked, setIsLocked] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(STORAGE_LOCK_KEY) === 'true';
  });

  const lastActivityRef = useRef<number>(Date.now());

  const lockSession = useCallback(() => {
    setIsLocked(true);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(STORAGE_LOCK_KEY, 'true');
    }
  }, []);

  const unlockSession = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIsLocked(false);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(STORAGE_LOCK_KEY);
    }
  }, []);

  // Update activity timestamp on user interaction
  useEffect(() => {
    if (!enabled || isLocked) return;

    const handleActivity = () => {
      lastActivityRef.current = Date.now();
    };

    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((ev) => window.addEventListener(ev, handleActivity, { passive: true }));

    // Periodic check every 15 seconds
    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= timeoutMs) {
        lockSession();
      }
    }, 15_000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, handleActivity));
      clearInterval(interval);
    };
  }, [enabled, isLocked, timeoutMs, lockSession]);

  return {
    isLocked,
    lockSession,
    unlockSession,
  };
}
