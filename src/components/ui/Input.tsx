// InwardsFlow Enterprise WMS — Input UI Component
import React from 'react';
import { cn } from '@/lib/utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, helperText, error, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-[13px] font-semibold text-secondary">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          className={cn(
            'w-full h-11 px-3 bg-white border border-edge rounded-control text-base sm:text-sm text-ink transition-colors focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:bg-soft disabled:cursor-not-allowed placeholder:text-muted',
            error && 'border-danger focus:border-danger focus:ring-danger/25',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs font-medium text-danger">{error}</p>}
        {!error && helperText && <p className="text-xs text-muted">{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
