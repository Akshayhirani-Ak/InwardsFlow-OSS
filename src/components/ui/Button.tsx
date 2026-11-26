// InwardsFlow Enterprise WMS — Button UI Component
// InwardsFlow Receiving & Inventory Engine
import React from 'react';
import { cn } from '@/lib/utils/cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading = false, children, disabled, ...props }, ref) => {
    const variantStyles = {
      primary: 'bg-accent hover:bg-pressed text-white border-transparent',
      secondary: 'bg-selection hover:bg-accent/15 text-accent border-transparent',
      danger: 'bg-danger hover:bg-danger/90 text-white border-transparent',
      success: 'bg-positive hover:bg-positive/90 text-white border-transparent',
      outline: 'bg-white hover:bg-soft text-ink border-edge',
      ghost: 'bg-transparent hover:bg-soft text-secondary border-transparent',
    }[variant];

    const sizeStyles = {
      sm: 'min-h-[44px] px-3 text-xs',
      md: 'min-h-[48px] px-4 text-sm',
      lg: 'min-h-[52px] px-6 text-base',
    }[size];

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          'inline-flex items-center justify-center rounded-control border font-semibold transition-colors duration-200 ease-out enabled:active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none',
          variantStyles,
          sizeStyles,
          className
        )}
        {...props}
      >
        {isLoading ? (
          <span className="flex items-center gap-1.5">
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>Processing...</span>
          </span>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
