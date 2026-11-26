// InwardsFlow Enterprise WMS â€” Modal UI Component
// InwardsFlow Receiving & Inventory Engine
'use client';

import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '6xl';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidth?: ModalSize;
  size?: ModalSize;
  children: React.ReactNode;
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  maxWidth,
  size,
  children,
}: ModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const resolvedSize = size || maxWidth || '2xl';

  const maxWidthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '4xl': 'max-w-4xl',
    '6xl': 'max-w-6xl',
  }[resolvedSize];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        className={cn(
          'w-full bg-surface rounded-panel shadow-dialog overflow-hidden flex flex-col max-h-[92dvh]',
          maxWidthClass
        )}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-line bg-soft flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-sm font-bold text-ink">{title}</h3>
            {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-muted hover:text-secondary hover:bg-line transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}
