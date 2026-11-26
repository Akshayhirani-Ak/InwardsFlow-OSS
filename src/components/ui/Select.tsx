import React, { type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('min-h-11 rounded-control border border-edge bg-surface px-3 text-base font-medium text-ink focus-visible:ring-2 focus-visible:ring-accent disabled:bg-soft sm:text-sm', className)} {...props} />;
}
