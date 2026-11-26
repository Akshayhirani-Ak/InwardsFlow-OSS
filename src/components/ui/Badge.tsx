// InwardsFlow Enterprise WMS — Badge UI Component
import React from 'react';
import { cn } from '@/lib/utils/cn';

export type BadgeVariant =
  | 'blue'
  | 'green'
  | 'amber'
  | 'red'
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md' | 'lg';
}

export function Badge({
  className,
  variant = 'neutral',
  size = 'md',
  children,
  ...props
}: BadgeProps) {
  const variantStyles: Record<BadgeVariant, string> = {
    blue: 'bg-selection text-accent border-accent/30',
    primary: 'bg-selection text-accent border-accent/30',
    green: 'bg-received text-positive border-positive/30',
    success: 'bg-received text-positive border-positive/30',
    amber: 'bg-attention text-warning border-warning/30',
    warning: 'bg-attention text-warning border-warning/30',
    red: 'bg-damage text-danger border-danger/30',
    danger: 'bg-damage text-danger border-danger/30',
    neutral: 'bg-soft text-secondary border-line',
  };

  const sizeStyles = {
    sm: 'px-1.5 py-px text-[11px]',
    md: 'px-2 py-0.5 text-xs',
    lg: 'px-2.5 py-1 text-[13px]',
  }[size];

  return (
    <span
      className={cn(
        'inline-flex items-center font-semibold uppercase tracking-wide rounded-full',
        variantStyles[variant],
        sizeStyles,
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
